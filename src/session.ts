import { UUID_RE, uuid } from './uuid';

/** Storage keys. strict_anonymous touches none of them except `union:optout`, and only after optOut() was called. */
export const K = { id: 'union:id', session: 'union:session', user: 'union:user', queue: 'union:queue', optout: 'union:optout', consent: 'union:consent' };

type Op = 'getItem' | 'setItem' | 'removeItem';
/** localStorage that never throws (private mode, blocked storage, quota). */
const ls = (op: Op, k: string, v?: string): string | null => {
  try {
    return (localStorage[op] as (k: string, v?: string) => string | null)(k, v);
  } catch {
    return null;
  }
};
export const store = {
  get: (k: string) => ls('getItem', k),
  set: (k: string, v: string) => void ls('setItem', k, v),
  del: (k: string) => void ls('removeItem', k),
};

/** Same rule as the server and `SessionManager.swift`: 30 minutes of inactivity ends a session. */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export interface User {
  id: string;
  traits?: Record<string, string>;
}

/** Reads JSON from storage; anything unparsable or of the wrong shape is treated as absent. */
function read<T>(k: string, ok: (v: any) => boolean): T | null {
  try {
    const v = JSON.parse(store.get(k) || 'null');
    return v && ok(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * product_analytics state: install id, session snapshot `{id, startedAt, lastActivityAt}` and identified user.
 * The session is re-read from storage on every touch so tabs share it; memory is the fallback.
 */
export function createState(now: () => number = Date.now) {
  let cur: { id: string; startedAt: number; lastActivityAt: number } | null = null;
  let id: string | null = null;
  let minted = false;
  let user: User | null | undefined;
  const save = (s: typeof cur) => (store.set(K.session, JSON.stringify((cur = s))), s!.id);
  const fresh = () => save({ id: uuid(7, now()), startedAt: now(), lastActivityAt: now() });
  return {
    /** The live session id; a new one if the last activity is 30+ minutes old. */
    touch(): string {
      const s = read<typeof cur>(K.session, (v) => typeof v.id == 'string' && typeof v.lastActivityAt == 'number') || cur;
      return s && now() - s.lastActivityAt < SESSION_TIMEOUT_MS ? save(Object.assign(s, { lastActivityAt: now() })) : fresh();
    },
    rotate: fresh,
    installId(): string {
      if (!id) {
        id = store.get(K.id);
        if (!id || !UUID_RE.test(id)) {
          store.set(K.id, (id = uuid(4)));
          // Only an id the browser kept is a first visit: with storage blocked every load mints one.
          minted = store.get(K.id) === id;
        }
      }
      return id;
    },
    /** True once, on the load that minted the stored id: the visitor's first visit in this browser. */
    takeFirstVisit(): boolean {
      this.installId();
      const m = minted;
      minted = false;
      return m;
    },
    user: (): User | null => (user === undefined ? (user = read<User>(K.user, (v) => typeof v.id == 'string')) : user),
    setUser(u: User | null): void {
      user = u;
      if (u) store.set(K.user, JSON.stringify(u));
      else store.del(K.user);
    },
  };
}
