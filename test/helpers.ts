import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { createApi } from '../src/api';
import { readConfig } from '../src/config';
import type { Config } from '../src/types';

const schema = JSON.parse(readFileSync(new URL('./fixtures/web-batch.v1.json', import.meta.url), 'utf8'));
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validateSchema = ajv.compile(schema);

const hasNull = (v: unknown): boolean => v === null || (!!v && typeof v === 'object' && Object.values(v).some(hasNull));

/**
 * Everything the JSON Schema cannot say but the contract's `superRefine` does: strict_anonymous carries no
 * identity and no session_id, product_analytics needs both, `page` rides on $pageview only, the path
 * has no query/fragment, and no key is ever null.
 */
export function assertBatch(b: any): void {
  const valid: boolean = validateSchema(b);
  if (!valid) throw new Error('batch violates web-batch.v1.json: ' + ajv.errorsText(validateSchema.errors));
  expect(hasNull(b), 'a batch never contains null').toBe(false);
  expect(b.events.length).toBeGreaterThan(0);
  expect(b.events.length).toBeLessThanOrEqual(100);
  expect(new TextEncoder().encode(JSON.stringify(b)).length).toBeLessThanOrEqual(256 * 1024);
  const strict = b.privacy_mode === 'strict_anonymous';
  if (strict) expect(b.identity).toEqual({});
  else expect(b.identity.install_id).toMatch(/^[0-9a-f-]{36}$/);
  for (const e of b.events) {
    expect(e.session_id === undefined).toBe(strict);
    if (e.screen !== undefined) {
      expect(e.screen.startsWith('/')).toBe(true);
      expect(/[?#]/.test(e.screen)).toBe(false);
    }
    if (e.page) expect(e.name).toBe('$pageview');
    if (e.name === '$pageview') expect(e.screen).toBeDefined();
    if (e.feature) expect(e.name.startsWith('$')).toBe(false);
  }
}

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Reject the fetch (network error). */
  fail?: boolean;
}

export interface Env {
  win: Window;
  /** Every request body the SDK sent via fetch, parsed. */
  fetched: any[];
  /** Every beacon payload, parsed. */
  beaconed: any[];
  fetchMock: ReturnType<typeof vi.fn>;
  beacon: ReturnType<typeof vi.fn>;
  /** Queue the replies for the next fetches (the last one repeats). Default: 202. */
  reply(...r: Reply[]): void;
  warn: any;
  /** Contract violations found in outgoing batches (checked again when the test ends). */
  errors: string[];
  /** All batches that left the page, in order. */
  batches(): any[];
  events(name?: string): any[];
}

let active: Env | null = null;

const GLOBALS = ['window', 'document', 'location', 'history', 'navigator', 'localStorage', 'innerWidth', 'innerHeight', 'scrollY', 'Storage'];

/** A fresh happy-dom window per test, installed as the globals the SDK reads, with fetch/sendBeacon captured and schema-checked. */
export function setupEnv(url = 'https://example.com/', opts: { referrer?: string } = {}): Env {
  const win = new Window({ url, width: 1280, height: 800 });
  const w = win as any;
  w.window = win;
  if (opts.referrer !== undefined) Object.defineProperty(win.document, 'referrer', { value: opts.referrer, configurable: true });
  for (const k of GLOBALS) vi.stubGlobal(k, w[k]);
  vi.stubGlobal('window', win);
  vi.stubGlobal('Storage', win.Storage);

  const fetched: any[] = [];
  const beaconed: any[] = [];
  const errors: string[] = [];
  const check = (b: any): void => {
    try {
      assertBatch(b);
    } catch (e) {
      errors.push(String((e as Error).message));
    }
  };
  let replies: Reply[] = [];
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    check(body);
    fetched.push(body);
    const r = replies.length > 1 ? replies.shift()! : replies[0] || {};
    if (r.fail) throw new TypeError('network');
    return new Response(r.body === undefined ? JSON.stringify({ accepted: 1, rejected: 0, batch_id: body.batch_id }) : JSON.stringify(r.body), {
      status: r.status ?? 202,
      headers: r.headers,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const beacon = vi.fn((_url: string, blob: Blob) => {
    (blob as any).text().then((t: string) => {
      const b = JSON.parse(t);
      check(b);
      beaconed.push(b);
    });
    return true;
  });
  (win.navigator as any).sendBeacon = beacon;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const env: Env = {
    win,
    fetched,
    beaconed,
    fetchMock,
    beacon,
    warn,
    errors,
    reply: (...r) => (replies = r),
    batches: () => [...fetched, ...beaconed],
    events: (name) => env.batches().flatMap((b) => b.events).filter((e: any) => !name || e.name === name),
  };
  active = env;
  return env;
}

/** Restores globals, and fails the test if any batch the SDK sent broke the contract. */
export function teardownEnv(): void {
  const errors = active ? active.errors : [];
  active = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (errors.length) throw new Error('batch violates the contract:\n' + errors.join('\n'));
}

/** `<script data-key=... >` for the current window. */
export function script(attrs: Record<string, string> = {}): Element {
  const el = (window as any).document.createElement('script');
  const all: Record<string, string> = { key: 'av_test', ...attrs };
  for (const k of Object.keys(all)) if (all[k] !== undefined) el.setAttribute('data-' + k, all[k]);
  return el;
}

export function config(attrs: Record<string, string> = {}): Config {
  const c = readConfig(script(attrs), (window as any).location.hostname);
  if (!c) throw new Error('config');
  return c;
}

/** Starts the SDK in the current env. */
export function start(attrs: Record<string, string> = {}) {
  return createApi(config(attrs));
}

/** Lets promises settle (fetch mock -> response -> next loop iteration) without moving fake timers. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

export async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

export function hide(env: Env, state: 'hidden' | 'visible' = 'hidden'): void {
  Object.defineProperty(env.win.document, 'visibilityState', { value: state, configurable: true });
  env.win.document.dispatchEvent(new env.win.Event('visibilitychange'));
}

export function pagehide(env: Env): void {
  env.win.dispatchEvent(new env.win.Event('pagehide'));
}

/** Scrolls the happy-dom window (it has no layout, so scrollY is set by hand) and fires `scroll`. */
export function scrollTo(env: Env, y: number): void {
  Object.defineProperty(env.win, 'scrollY', { value: y, configurable: true });
  env.win.dispatchEvent(new env.win.Event('scroll'));
}

export function useEnv(url?: string, opts?: { referrer?: string }): () => Env {
  let env!: Env;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-25T10:00:00Z') });
    env = setupEnv(url, opts);
  });
  afterEach(teardownEnv);
  return () => env;
}

