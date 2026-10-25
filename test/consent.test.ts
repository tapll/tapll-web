import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { start, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/pricing?utm_source=hn');

/** Every write the page could make. */
function writes() {
  const proto = Object.getPrototypeOf(env().win.localStorage);
  return { set: vi.spyOn(proto, 'setItem'), del: vi.spyOn(proto, 'removeItem') };
}

describe('data-consent: nothing is stored or sent before the visitor answers', () => {
  it('holds events in memory, then sends them — first touch included — after consent(true)', async () => {
    const w = writes();
    const { api } = start({ mode: 'product_analytics', consent: 'required' });
    api.track('cta_clicked');
    api.identify('u1');
    expect(api.consentStatus()).toBe('pending');
    await tick(6000);
    await api.flush();
    expect(env().fetched.length).toBe(0);
    expect(w.set).not.toHaveBeenCalled();

    api.consent(true);
    await api.flush();
    expect(api.consentStatus()).toBe('granted');
    const events = env().events();
    expect(events.map((e: any) => e.name)).toEqual(expect.arrayContaining(['$pageview', 'cta_clicked']));
    // Sessions are created on release, not before: every released event carries one.
    expect(events.every((e: any) => typeof e.session_id === 'string')).toBe(true);
    expect(events.find((e: any) => e.name === '$pageview').page.utm_source).toBe('hn');
    expect(env().batches().at(-1).identity.user_id).toBe('u1');
    expect(env().win.localStorage.getItem('union:consent')).toBe('granted');
  });

  it('decline is optOut(): the held events are dropped and nothing is ever sent', async () => {
    const { api } = start({ mode: 'product_analytics', consent: 'required' });
    api.track('cta_clicked');
    api.consent(false);
    api.track('after');
    await tick(6000);
    await api.flush();
    expect(env().fetched.length).toBe(0);
    expect(api.consentStatus()).toBe('denied');
    expect(env().win.localStorage.getItem('union:optout')).toBe('1');
    expect(env().win.localStorage.getItem('union:id')).toBeNull();
  });

  it('remembers an answer: a later page load starts collecting at once', async () => {
    env().win.localStorage.setItem('union:consent', 'granted');
    const { api } = start({ mode: 'product_analytics', consent: 'banner' });
    expect(api.consentStatus()).toBe('granted');
    await api.flush();
    expect(env().events().some((e: any) => e.name === '$pageview')).toBe(true);
  });

  it('remembers a decline across loads', async () => {
    env().win.localStorage.setItem('union:optout', '1');
    const { api } = start({ mode: 'product_analytics', consent: 'banner' });
    expect(api.consentStatus()).toBe('denied');
  });

  it('without data-consent nothing changes: collection starts at load', async () => {
    const { api } = start({ mode: 'product_analytics' });
    expect(api.consentStatus()).toBe('not_required');
    await api.flush();
    expect(env().events().length).toBeGreaterThan(0);
  });

  it('a strict site may still ask: nothing is sent before the answer, nothing is stored but the answer', async () => {
    const w = writes();
    const { api } = start({ consent: 'required' });
    await api.flush();
    expect(env().fetched.length).toBe(0);
    api.consent(true);
    await api.flush();
    expect(env().events().length).toBeGreaterThan(0);
    expect(w.set.mock.calls.map(([k]) => k)).toEqual(['union:consent']);
    for (const b of env().batches()) expect(b.identity).toEqual({});
  });

  it('caps what waits in memory', async () => {
    const { api } = start({ consent: 'required' });
    for (let i = 0; i < 250; i++) api.track('spam');
    api.consent(true);
    await api.flush();
    expect(env().events().length).toBeLessThanOrEqual(100);
  });
});

describe('consent.js', () => {
  it('renders Accept and Decline with equal weight and answers through union.consent', async () => {
    const w = env().win as any;
    const calls: unknown[] = [];
    w.union = (...a: unknown[]) => calls.push(a);
    const tag = w.document.createElement('script');
    tag.setAttribute('data-key', 'av_x');
    tag.setAttribute('data-consent', 'banner');
    tag.setAttribute('data-consent-policy', 'https://example.com/privacy');
    w.document.head.appendChild(tag);
    new w.Function(readFileSync(new URL('../dist/consent.js', import.meta.url), 'utf8'))();
    const host = w.document.getElementById('union-consent');
    expect(host).toBeTruthy();
    const buttons = Array.from(host.shadowRoot.querySelectorAll('button')) as any[];
    expect(buttons.map((b) => b.textContent)).toEqual(['Decline', 'Accept']);
    expect(buttons[0].className).toBe(buttons[1].className);
    expect(host.shadowRoot.querySelector('a').getAttribute('href')).toBe('https://example.com/privacy');
    buttons[1].click();
    expect(calls).toEqual([['consent', true]]);
    expect(w.document.getElementById('union-consent')).toBeNull();
  });
});

describe('u.js loads the banner itself', () => {
  it('injects consent.js from next to u.js while the answer is pending, and not after it', async () => {
    const { boot } = await import('../src/boot');
    const w = env().win as any;
    const tag = w.document.createElement('script');
    tag.setAttribute('src', 'https://cdn.useunion.dev/v0/u.js');
    tag.setAttribute('data-key', 'av_x');
    tag.setAttribute('data-mode', 'product_analytics');
    tag.setAttribute('data-consent', 'banner');
    boot(tag);
    const injected = w.document.querySelector('script[data-union-consent]');
    expect(injected?.getAttribute('src')).toBe('https://cdn.useunion.dev/v0/consent.js');

    // A visitor who already answered never sees it again.
    injected.remove();
    delete w.union;
    w.localStorage.setItem('union:consent', 'granted');
    boot(tag);
    expect(w.document.querySelector('script[data-union-consent]')).toBeNull();
  });
});
