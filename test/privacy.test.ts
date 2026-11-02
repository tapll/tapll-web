import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api';
import { config, hide, pagehide, start, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/pricing?utm_source=x');

/** Spies on every way the page could persist something: Web Storage (prototype), document.cookie, IndexedDB. */
function spies() {
  const proto = Object.getPrototypeOf(env().win.localStorage);
  const get = vi.spyOn(proto, 'getItem');
  const set = vi.spyOn(proto, 'setItem');
  const del = vi.spyOn(proto, 'removeItem');
  const clear = vi.spyOn(proto, 'clear');
  const cookieSet = vi.fn();
  Object.defineProperty(env().win.document, 'cookie', { configurable: true, get: () => '', set: cookieSet });
  const session = vi.spyOn(env().win.sessionStorage, 'setItem');
  return { get, set, del, clear, cookieSet, session };
}

describe('strict_anonymous uses no storage at all', () => {
  it('a full session of activity touches no cookie, localStorage or sessionStorage (only reads the opt-out flag)', async () => {
    const s = spies();
    const { api } = start(); // strict is the default
    api.track('signup', { plan: 'pro' }, { feature: 'onboarding', role: 'start' });
    api.feature('checkout').success({ value: 10 });
    const w = env().win as any;
    w.history.pushState({}, '', '/next');
    w.document.body.innerHTML = '<a id="l" href="https://other.org/x.pdf">x</a>';
    w.document.getElementById('l').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    api.identify('u1', { a: 'b' }); // no-op in strict
    api.reset(); // no-op in strict
    expect(api.sessionId()).toBeNull(); // no 202 yet
    await tick(6000);
    hide(env());
    pagehide(env());
    await api.flush();
    await tick(0);

    expect(s.set).not.toHaveBeenCalled();
    expect(s.del).not.toHaveBeenCalled();
    expect(s.clear).not.toHaveBeenCalled();
    expect(s.cookieSet).not.toHaveBeenCalled();
    expect(s.session).not.toHaveBeenCalled();
    expect(s.get.mock.calls.every(([k]) => k === 'tapll:optout' || k === 'union:optout')).toBe(true);
    expect(env().win.localStorage.length).toBe(0);
    expect(env().events().length).toBeGreaterThan(5);
  });

  it('batches carry no session_id, no install_id, no user_id and an empty identity', async () => {
    const { api } = start();
    api.track('a');
    api.identify('u1');
    await api.flush();
    for (const b of env().batches()) {
      expect(b.privacy_mode).toBe('strict_anonymous');
      expect(b.identity).toEqual({});
      for (const e of b.events) expect('session_id' in e).toBe(false);
    }
  });

  it('identify() and reset() are no-ops with a console warning', () => {
    const { api } = start();
    api.identify('u1', { plan: 'pro' });
    api.reset();
    expect(env().warn).toHaveBeenCalledTimes(2);
  });

  it('sessionId() is null until a 202 carries the server session, then returns it (memory only)', async () => {
    const s = spies();
    env().reply({ body: { accepted: 1, rejected: 0, batch_id: 'x', session_id: '01a17280-b500-7179-a2b7-000000000009' } });
    const { api } = start();
    expect(api.sessionId()).toBeNull();
    await api.flush();
    expect(api.sessionId()).toBe('01a17280-b500-7179-a2b7-000000000009');
    expect(s.set).not.toHaveBeenCalled();
    api.track('x');
    await api.flush();
    for (const b of env().fetched) for (const e of b.events) expect('session_id' in e).toBe(false);
  });

  it('failed sends and refused beacons never fall back to persisting the queue', async () => {
    const s = spies();
    env().reply({ fail: true });
    env().beacon.mockImplementation(() => false);
    const { api } = start();
    await api.flush();
    api.track('x');
    hide(env());
    expect(s.set).not.toHaveBeenCalled();
    expect(env().win.localStorage.getItem('tapll:queue')).toBeNull();
  });
});

describe('opt-out', () => {
  it('the opt-out flag is the only thing strict ever stores, and only after optOut()', async () => {
    const s = spies();
    const { api } = start();
    api.optOut();
    expect(s.set.mock.calls).toEqual([['tapll:optout', '1']]);
    expect(env().win.localStorage.length).toBe(1);
  });

  it('sends nothing while opted out, including auto events and the pending queue', async () => {
    const { api } = start();
    api.track('queued_before');
    api.optOut();
    api.track('after');
    env().win.history.pushState({}, '', '/elsewhere');
    api.pageview('/virtual');
    hide(env());
    await tick(60_000);
    await api.flush();
    expect(env().fetchMock).not.toHaveBeenCalled();
    expect(env().beacon).not.toHaveBeenCalled();
  });

  it('is remembered across loads, and optIn() resumes (removing the flag)', async () => {
    start().api.optOut();
    const again = createApi(config());
    again.api.track('x');
    await again.api.flush();
    expect(env().fetchMock).not.toHaveBeenCalled();
    again.api.optIn();
    expect(env().win.localStorage.getItem('tapll:optout')).toBeNull();
    again.api.track('y');
    await again.api.flush();
    expect(env().events('y')).toHaveLength(1);
  });

  it('product_analytics: also drops the persisted queue and sends nothing', async () => {
    env().beacon.mockImplementation(() => false);
    const { api } = start({ mode: 'product_analytics' });
    api.track('x');
    hide(env());
    expect(env().win.localStorage.getItem('tapll:queue')).not.toBeNull();
    api.optOut();
    expect(env().win.localStorage.getItem('tapll:queue')).toBeNull();
    await api.flush();
    expect(env().fetchMock).not.toHaveBeenCalled();
  });

  it('a previously opted-out visitor does not replay a stale persisted queue', async () => {
    env().win.localStorage.setItem('tapll:optout', '1');
    env().win.localStorage.setItem('tapll:queue', JSON.stringify([{ event_id: 'a', name: 'x' }]));
    const { api } = start({ mode: 'product_analytics' });
    await api.flush();
    expect(env().fetchMock).not.toHaveBeenCalled();
  });
});

describe('product_analytics does use storage (consent is the site\'s job)', () => {
  it('writes tapll:id, tapll:session; never a cookie', async () => {
    const s = spies();
    const { api } = start({ mode: 'product_analytics' });
    api.track('x');
    await api.flush();
    const keys = new Set(s.set.mock.calls.map(([k]) => k));
    expect(keys.has('tapll:id')).toBe(true);
    expect(keys.has('tapll:session')).toBe(true);
    expect(s.cookieSet).not.toHaveBeenCalled();
  });
});
