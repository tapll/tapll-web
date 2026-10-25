import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api';
import { createState, SESSION_TIMEOUT_MS } from '../src/session';
import { UUID_RE } from '../src/uuid';
import { config, start, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/');
const pa = { mode: 'product_analytics' };
const MIN = 60_000;

describe('createState (session rules, same as SessionManager.swift)', () => {
  it('timeout is the server one: 30 minutes', () => expect(SESSION_TIMEOUT_MS).toBe(30 * MIN));

  it('keeps the session inside the window and rotates after 30 minutes of inactivity', async () => {
    const st = createState();
    const a = st.touch();
    expect(UUID_RE.test(a)).toBe(true);
    await tick(30 * MIN - 1);
    expect(st.touch()).toBe(a);
    await tick(30 * MIN - 1); // activity extended the window
    expect(st.touch()).toBe(a);
    await tick(30 * MIN);
    const b = st.touch();
    expect(b).not.toBe(a);
    expect(st.touch()).toBe(b);
  });

  it('persists {id, startedAt, lastActivityAt} in localStorage union:session', async () => {
    const st = createState();
    const id = st.touch();
    const t0 = Date.now();
    await tick(5 * MIN);
    st.touch();
    expect(JSON.parse(env().win.localStorage.getItem('union:session')!)).toEqual({ id, startedAt: t0, lastActivityAt: t0 + 5 * MIN });
  });

  it('a second instance (another tab / a reload) continues the stored session', async () => {
    const id = createState().touch();
    await tick(10 * MIN);
    expect(createState().touch()).toBe(id);
    await tick(31 * MIN);
    expect(createState().touch()).not.toBe(id);
  });

  it('rotate() forces a new session', () => {
    const st = createState();
    const a = st.touch();
    expect(st.rotate()).not.toBe(a);
  });

  it('corrupt snapshots are ignored', () => {
    env().win.localStorage.setItem('union:session', '{{{');
    expect(UUID_RE.test(createState().touch())).toBe(true);
    env().win.localStorage.setItem('union:session', JSON.stringify({ id: 5 }));
    expect(UUID_RE.test(createState().touch())).toBe(true);
  });

  it('works from memory when storage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    const st = createState();
    const a = st.touch();
    expect(st.touch()).toBe(a);
    expect(st.installId()).toBe(st.installId());
    await tick(31 * MIN);
    expect(st.touch()).not.toBe(a);
  });

  it('install id: UUID, stored in union:id, stable across instances, replaced if damaged', () => {
    const id = createState().installId();
    expect(UUID_RE.test(id)).toBe(true);
    expect(env().win.localStorage.getItem('union:id')).toBe(id);
    expect(createState().installId()).toBe(id);
    env().win.localStorage.setItem('union:id', 'garbage');
    const fresh = createState().installId();
    expect(UUID_RE.test(fresh)).toBe(true);
  });
});

describe('product_analytics through the API', () => {
  it('every event carries session_id; install_id in identity', async () => {
    const { api } = start(pa);
    api.track('a');
    api.pageview('/x');
    await api.flush();
    const b = env().fetched[0];
    expect(b.privacy_mode).toBe('product_analytics');
    expect(b.identity).toEqual({ install_id: env().win.localStorage.getItem('union:id') });
    const sessions = new Set(b.events.map((e: any) => e.session_id));
    expect(sessions.size).toBe(1);
    expect(b.events.every((e: any) => UUID_RE.test(e.session_id))).toBe(true);
  });

  it('a new session after more than 30 minutes idle, same one before', async () => {
    const { api } = start(pa);
    api.track('a');
    await tick(29 * MIN);
    api.track('b'); // extends the session
    await tick(29 * MIN);
    api.track('c');
    await tick(31 * MIN);
    api.track('d');
    await api.flush();
    const byName = Object.fromEntries(env().events().filter((e) => !e.name.startsWith('$')).map((e) => [e.name, e.session_id]));
    expect(byName.b).toBe(byName.a);
    expect(byName.c).toBe(byName.a);
    expect(byName.d).not.toBe(byName.a);
  });

  it('sessionId() returns the live session id (what the next event carries)', async () => {
    const { api } = start(pa);
    const id = api.sessionId();
    expect(UUID_RE.test(id!)).toBe(true);
    api.track('x');
    await api.flush();
    expect(env().events('x')[0].session_id).toBe(id);
  });

  it('identify: user_id and traits join the identity and persist in union:user', async () => {
    const { api } = start(pa);
    api.identify('user_42', { plan: 'pro', name: 'Ada' });
    api.track('x');
    await api.flush();
    expect(env().fetched[0].identity).toMatchObject({ user_id: 'user_42', traits: { plan: 'pro', name: 'Ada' } });
    expect(JSON.parse(env().win.localStorage.getItem('union:user')!)).toEqual({ id: 'user_42', traits: { plan: 'pro', name: 'Ada' } });
    // a reload keeps the user
    const again = createApi(config(pa));
    again.api.track('y');
    await again.api.flush();
    expect(env().fetched.at(-1).identity.user_id).toBe('user_42');
  });

  it('identify without traits sends no traits key', async () => {
    const { api } = start(pa);
    api.identify('u1');
    await api.flush();
    expect('traits' in env().fetched[0].identity).toBe(false);
  });

  it('identify with invalid input is dropped with a warning and leaves identity alone', async () => {
    const { api } = start(pa);
    api.identify('x'.repeat(129));
    api.identify('');
    api.identify('u', { a: 1 } as any);
    api.identify('u', Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['k' + i, 'v'])));
    await api.flush();
    expect(env().fetched[0].identity.user_id).toBeUndefined();
    expect(env().win.localStorage.getItem('union:user')).toBeNull();
    expect(env().warn).toHaveBeenCalled();
  });

  it('reset(): clears the user, starts a new session, keeps the install id', async () => {
    const { api } = start(pa);
    api.identify('user_42', { plan: 'pro' });
    api.track('before');
    const installId = env().win.localStorage.getItem('union:id') ?? api.sessionId() ?? '';
    api.reset();
    api.track('after');
    await api.flush();
    const [before, after] = [env().events('before')[0], env().events('after')[0]];
    expect(after.session_id).not.toBe(before.session_id);
    const last = env().fetched.at(-1);
    expect(last.identity.user_id).toBeUndefined();
    expect(last.identity.install_id).toBe(env().win.localStorage.getItem('union:id'));
    expect(env().win.localStorage.getItem('union:user')).toBeNull();
    void installId;
  });
});
