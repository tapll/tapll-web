import { backoff, decide, type Reply } from './policy';
import { K, store } from './session';
import type { WebEvent } from './types';
import { uuid } from './uuid';
import { warn } from './validation';

export const FLUSH_MS = 5000;
export const FLUSH_AT = 20;
export const MAX_EVENTS = 100;
export const MAX_BYTES = 256 * 1024;
export const MAX_QUEUE = 1000;
export const MAX_PERSISTED = 200;

export interface TransportOptions {
  url: string;
  /** product_analytics: unsent events survive a reload via `tapll:queue`. */
  persist: boolean;
  /** Wraps events into a `WebEventBatch` (identity/device are read at send time). */
  build: (events: WebEvent[], batchId: string) => unknown;
  /** Called with the parsed body of every 202. */
  accepted: (body: any) => void;
}

const TYPE = 'text/plain;charset=UTF-8';

/**
 * In-memory queue with batching, retry and the response policy. Events stay queued until the server
 * acknowledges them; `gen` invalidates an in-flight result after the queue was cleared or beaconed.
 */
export function createTransport(o: TransportOptions) {
  const q: WebEvent[] = [];
  let timer: any = 0;
  let busy = false;
  let run: Promise<void> = Promise.resolve();
  let paused = false;
  let stopped = false;
  let gen = 0;
  let cap = MAX_EVENTS;
  let attempt = 0;
  let bid = '';
  let bn = 0;

  /** JSON for events [from, from+n), halving n until it fits 256 KB. A retry of the same prefix keeps its batch_id. */
  function pack(from: number, n: number): [number, string] {
    for (;;) {
      const id = !from && n === bn ? bid : uuid(4);
      const s = JSON.stringify(o.build(q.slice(from, from + n), id));
      if (n < 2 || new Blob([s]).size <= MAX_BYTES) return !from && ((bid = id), (bn = n)), [n, s];
      n >>= 1;
    }
  }

  async function post(body: string): Promise<Reply> {
    try {
      const r = await fetch(o.url, { method: 'POST', body, headers: { 'content-type': TYPE }, keepalive: new Blob([body]).size < 60 * 1024, credentials: 'omit' });
      return { status: r.status, body: await r.json().catch(() => 0), retryAfter: r.headers.get('retry-after') };
    } catch {
      return { status: 0 };
    }
  }

  function pause(ms: number): void {
    paused = true;
    setTimeout(() => ((paused = false), void drain()), ms);
  }

  /** Sends until the queue is empty. Concurrent callers share the running loop, so `flush()` resolves when it is done. */
  function drain(): Promise<void> {
    if (!(busy || paused || stopped)) run = loop().catch(() => undefined);
    return run;
  }

  async function loop(): Promise<void> {
    busy = true;
    try {
      while (q.length && !stopped && !paused) {
        const g = gen;
        const [n, s] = pack(0, Math.min(q.length, cap));
        const r = await post(s);
        if (g !== gen) continue;
        const d = decide(r);
        if (d.t === 'ok') (o.accepted(r.body), q.splice(0, n), (attempt = 0), (cap = MAX_EVENTS), (bn = 0));
        else if (d.t === 'drop' && d.idx.some((i) => i < n)) {
          // Drop the events the server named and resend the rest at once (every round removes at least one).
          const bad = d.idx;
          q.splice(0, n, ...q.slice(0, n).filter((_, i) => bad.indexOf(i) < 0));
          bn = 0;
        } else if (d.t === 'drop' || d.t === 'batch') (warn('batch rejected'), q.splice(0, n), (bn = 0));
        else if (d.t === 'split') (n < 2 && q.shift(), (cap = Math.max(1, n >> 1)));
        else if (d.t === 'stop') {
          stopped = true;
          q.length = 0;
          if (o.persist) store.del(K.queue);
          warn('stopped: HTTP ' + r.status);
        } else pause(d.t === 'pause' ? d.ms : backoff(attempt++));
      }
    } finally {
      busy = false;
      if (!q.length && o.persist && !stopped) store.del(K.queue);
    }
  }

  return {
    push(e: WebEvent): void {
      if (stopped) return;
      q.push(e);
      if (q.length > MAX_QUEUE) q.shift();
      if (q.length >= FLUSH_AT) void drain();
      else if (!timer) timer = setTimeout(() => ((timer = 0), void drain()), FLUSH_MS);
    },
    /** Loads events left over from a previous page load. */
    restore(): void {
      if (!o.persist) return;
      try {
        q.unshift(...JSON.parse(store.get(K.queue) || '[]').filter((e: WebEvent) => e && e.event_id && e.name));
        q.splice(0, q.length - MAX_QUEUE);
      } catch {
        /* corrupt queue: ignore */
      }
      void drain();
    },
    flush: drain,
    /** Page is going away: hand everything to sendBeacon, keep what it refuses (and persist it). */
    hide(): void {
      if (stopped) return;
      if (!navigator.sendBeacon) void drain();
      else if (!paused) {
        let i = 0;
        while (i < q.length) {
          const [n, s] = pack(i, Math.min(q.length - i, MAX_EVENTS));
          let ok = false;
          try {
            ok = navigator.sendBeacon(o.url, new Blob([s], { type: TYPE }));
          } catch {
            /* treated as refused */
          }
          if (!ok) break;
          i += n;
        }
        if (i) (q.splice(0, i), gen++, (bn = 0));
      }
      if (o.persist) q.length ? store.set(K.queue, JSON.stringify(q.slice(-MAX_PERSISTED))) : store.del(K.queue);
    },
    clear(): void {
      q.length = bn = 0;
      gen++;
      clearTimeout(timer);
      timer = 0;
    },
    get stopped(): boolean {
      return stopped;
    },
  };
}

export type Transport = ReturnType<typeof createTransport>;
