import { describe, expect, it } from 'vitest';
import { start, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/');
const pa = { mode: 'product_analytics' };
const OLD_ID = '01a17280-b500-7179-a2b7-0000000000aa';
const NEW_ID = '01a17280-b500-7179-a2b7-0000000000bb';
const ls = () => env().win.localStorage;
const oldKeys = () => Object.keys(ls() as any).filter((k) => k.startsWith('union:'));
const names = () => env().events().map((e) => e.name);

describe('migration from union:* to tapll:* (once, on load)', () => {
  it('old only: id, session, user move; the visitor is not new again (no $first_open)', async () => {
    const session = { id: '01a17280-b500-7179-a2b7-0000000000cc', startedAt: Date.now(), lastActivityAt: Date.now() };
    ls().setItem('union:id', OLD_ID);
    ls().setItem('union:session', JSON.stringify(session));
    ls().setItem('union:user', JSON.stringify({ id: 'u1', traits: { plan: 'pro' } }));
    const { api } = start(pa);
    api.track('x');
    await api.flush();
    expect(ls().getItem('tapll:id')).toBe(OLD_ID);
    expect(JSON.parse(ls().getItem('tapll:user')!)).toEqual({ id: 'u1', traits: { plan: 'pro' } });
    expect(JSON.parse(ls().getItem('tapll:session')!).id).toBe(session.id);
    expect(oldKeys()).toEqual([]);
    expect(names()).not.toContain('$first_open');
    expect(env().batches()[0].identity).toEqual({ install_id: OLD_ID, user_id: 'u1', traits: { plan: 'pro' } });
  });

  it('old only: a pending queue is still sent, then both keys are gone', async () => {
    const ev = { event_id: '01a17280-b500-7179-a2b7-000000000001', session_id: '01a17280-b500-7179-a2b7-000000000002', name: 'left_over', timestamp: 1 };
    ls().setItem('union:id', OLD_ID);
    ls().setItem('union:queue', JSON.stringify([ev]));
    const { api } = start(pa);
    await api.flush();
    expect(names()).toContain('left_over');
    expect(ls().getItem('union:queue')).toBeNull();
    expect(ls().getItem('tapll:queue')).toBeNull();
  });

  it('old only: opt-out is honoured', async () => {
    ls().setItem('union:optout', '1');
    const { api } = start(pa);
    api.track('x');
    await api.flush();
    expect(env().events()).toEqual([]);
    expect(ls().getItem('tapll:optout')).toBe('1');
    expect(oldKeys()).toEqual([]);
  });

  it('old only: opt-out is honoured in strict_anonymous too, and nothing else is read or written', async () => {
    ls().setItem('union:optout', '1');
    ls().setItem('union:id', OLD_ID);
    const { api } = start();
    api.track('x');
    await api.flush();
    expect(env().events()).toEqual([]);
    expect(ls().getItem('tapll:optout')).toBe('1');
    expect(ls().getItem('union:id')).toBe(OLD_ID); // strict_anonymous never touches the data keys
    expect(ls().getItem('tapll:id')).toBeNull();
  });

  it('old only: granted consent is honoured (data-consent), no banner wait', async () => {
    ls().setItem('union:consent', 'granted');
    const { api } = start({ ...pa, consent: 'required' });
    expect(api.consentStatus()).toBe('granted');
    api.track('x');
    await api.flush();
    expect(names()).toContain('x');
    expect(ls().getItem('tapll:consent')).toBe('granted');
    expect(ls().getItem('union:consent')).toBeNull();
  });

  it('consent pending: old data stays untouched, then moves on accept without a new first-open', async () => {
    ls().setItem('union:id', OLD_ID);
    const { api } = start({ ...pa, consent: 'required' });
    api.track('x');
    expect(ls().getItem('tapll:id')).toBeNull();
    expect(ls().getItem('union:id')).toBe(OLD_ID);
    api.consent(true);
    await api.flush();
    expect(ls().getItem('tapll:id')).toBe(OLD_ID);
    expect(ls().getItem('union:id')).toBeNull();
    expect(names()).not.toContain('$first_open');
  });

  it('both present: the new key wins, the old one is removed', async () => {
    ls().setItem('union:id', OLD_ID);
    ls().setItem('tapll:id', NEW_ID);
    ls().setItem('union:optout', '1');
    const { api } = start(pa);
    api.track('x');
    await api.flush();
    expect(ls().getItem('tapll:id')).toBe(NEW_ID);
    expect(oldKeys()).toEqual([]);
    expect(ls().getItem('tapll:optout')).toBe('1'); // old flag survives where the new key was absent
    expect(names()).not.toContain('$first_open');
  });

  it('neither: a normal first visit (one $first_open) and no union:* key is written', async () => {
    const { api } = start(pa);
    api.track('x');
    await api.flush();
    expect(names().filter((n) => n === '$first_open')).toHaveLength(1);
    expect(ls().getItem('tapll:id')).not.toBeNull();
    expect(oldKeys()).toEqual([]);
  });

  it('migration runs once: a second load does not resurrect or re-read anything harmful', async () => {
    ls().setItem('union:id', OLD_ID);
    start(pa);
    await tick(0);
    start(pa);
    expect(ls().getItem('tapll:id')).toBe(OLD_ID);
    expect(oldKeys()).toEqual([]);
  });
});
