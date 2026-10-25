import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../src/api';
import { config, hide, settle, start, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/');
const ids = (b: any) => b.events.map((e: any) => e.event_id);
const track = (api: any, n: number, props: any = {}) => {
  for (let i = 0; i < n; i++) api.track('e', { i, ...props });
};
const d400 = (...paths: string[]) => ({ status: 400, body: { error: 'invalid_batch', message: 'rejected', details: paths.map((path) => ({ path, message: 'bad' })) } });

describe('request shape', () => {
  it('POSTs text/plain with the key in the body: no custom headers, credentials omitted, keepalive when small', async () => {
    const { api } = start();
    await api.flush();
    const [url, init] = env().fetchMock.mock.calls[0];
    expect(url).toBe('https://in.useunion.dev/v1/web');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'text/plain;charset=UTF-8' });
    expect(init.credentials).toBe('omit');
    expect(init.keepalive).toBe(true);
    expect(env().fetched[0].key).toBe('av_test');
  });

  it('posts to the first-party proxy given by data-api', async () => {
    const { api } = start({ api: '/_union' });
    await api.flush();
    expect(env().fetchMock.mock.calls[0][0]).toBe('/_union/v1/web');
  });

  it('keepalive is off for bodies of 60 KB and more', async () => {
    const { api } = start();
    track(api, 9, { big: 'x'.repeat(256), b2: 'y'.repeat(256), b3: 'y'.repeat(256), b4: 'y'.repeat(256) });
    for (let i = 0; i < 12; i++) api.track('big', Object.fromEntries(Array.from({ length: 32 }, (_, k) => ['k' + k, 'z'.repeat(256)])));
    await api.flush();
    const sizes = env().fetchMock.mock.calls.map(([, init]) => ({ big: init.body.length >= 60 * 1024, keepalive: init.keepalive }));
    expect(sizes.some((s) => s.big)).toBe(true);
    for (const s of sizes) expect(s.keepalive).toBe(!s.big);
  });

  it('batch envelope: contract_version, environment, privacy_mode, sent_at, device', async () => {
    const { api } = start({ version: '2026.10.1' });
    await api.flush();
    const b = env().fetched[0];
    expect(b).toMatchObject({ contract_version: 1, environment: 'production', privacy_mode: 'strict_anonymous', identity: {} });
    expect(b.sent_at).toBe(Date.now());
    expect(b.device).toMatchObject({ os_name: 'Web', sdk_version: '0.2.1', app_version: '2026.10.1', screen_width: 1280 });
    expect(typeof b.device.locale).toBe('string');
    expect(b.device.timezone).toBeTypeOf('string');
    expect(b.batch_id).toMatch(/^[0-9a-f-]{36}$/);
    for (const e of b.events) expect(e.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('omits absent keys (no app_version, no properties) and never sends null', async () => {
    const { api } = start();
    await api.flush();
    const b = env().fetched[0];
    expect('app_version' in b.device).toBe(false);
    expect('properties' in b.events[0]).toBe(false);
    expect(JSON.stringify(b)).not.toContain('null');
  });

  it('localhost is the development environment', async () => {
    const e = env();
    Object.defineProperty(e.win, 'location', { value: new URL('http://localhost:3000/') });
    vi.stubGlobal('location', new URL('http://localhost:3000/'));
    const { api } = start();
    await api.flush();
    expect(e.fetched[0].environment).toBe('development');
  });
});

describe('flush triggers', () => {
  it('every 5 seconds', async () => {
    const { api } = start();
    api.track('one');
    await tick(4999);
    expect(env().fetchMock).not.toHaveBeenCalled();
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    expect(env().fetched[0].events.map((e: any) => e.name)).toEqual(['$pageview', 'one']);
  });

  it('immediately at 20 events', async () => {
    const { api } = start();
    track(api, 18);
    await settle();
    expect(env().fetchMock).not.toHaveBeenCalled();
    track(api, 1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    expect(env().fetched[0].events).toHaveLength(20);
  });

  it('splits into batches of at most 100 events and keeps order', async () => {
    const { api } = start();
    track(api, 250);
    await api.flush();
    const all = env().fetched.flatMap((b: any) => b.events);
    expect(env().fetched.every((b: any) => b.events.length <= 100)).toBe(true);
    expect(all).toHaveLength(251);
    expect(all.slice(1).map((e: any) => e.properties.i)).toEqual(Array.from({ length: 250 }, (_, i) => i));
  });

  it('splits batches over 256 KB (every body fits)', async () => {
    const { api } = start();
    const big = Object.fromEntries(Array.from({ length: 32 }, (_, k) => ['k' + k, 'q'.repeat(256)]));
    for (let i = 0; i < 120; i++) api.track('big', big);
    await api.flush();
    expect(env().fetched.length).toBeGreaterThan(3);
    for (const [, init] of env().fetchMock.mock.calls) expect(new Blob([init.body]).size).toBeLessThanOrEqual(256 * 1024);
    expect(env().fetched.flatMap((b: any) => b.events)).toHaveLength(121);
  });

  it('flush() with nothing queued sends nothing and resolves', async () => {
    const { api } = start();
    await api.flush();
    await api.flush();
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('response policy', () => {
  it('202: queue is cleared, nothing is resent', async () => {
    const { api } = start();
    api.track('x');
    await api.flush();
    await tick(60_000);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400 naming events: drops those and resends the rest with the same event ids', async () => {
    env().reply(d400('events.1.properties.a', 'events.2.name'), { status: 202 });
    const { api } = start();
    api.track('a');
    api.track('b');
    api.track('c');
    await api.flush();
    const [first, second] = env().fetched;
    expect(first.events).toHaveLength(4);
    expect(ids(second)).toEqual([ids(first)[0], ids(first)[3]]);
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
  });

  it('400 with an envelope problem: the whole batch is dropped, no resend', async () => {
    env().reply(d400('events.0.name', 'identity'), { status: 202 });
    const { api } = start();
    await api.flush();
    await tick(60_000);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    api.track('later');
    await api.flush();
    expect(env().fetched[1].events.map((e: any) => e.name)).toEqual(['later']);
  });

  it('400 without event paths: batch dropped', async () => {
    env().reply({ status: 400, body: { error: 'invalid_batch', message: 'x' } }, { status: 202 });
    const { api } = start();
    await api.flush();
    await tick(60_000);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400 with an unparsable body: batch dropped', async () => {
    env().fetchMock.mockImplementationOnce(async () => new Response('<html>', { status: 400 }));
    const { api } = start();
    await api.flush();
    await tick(60_000);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
  });

  for (const status of [401, 403]) {
    it(`${status}: the SDK stops for the page load (no more requests, queue dropped)`, async () => {
      env().reply({ status, body: { error: status === 401 ? 'invalid_write_key' : 'origin_not_allowed', message: 'no' } });
      const { api } = start();
      await api.flush();
      expect(env().fetchMock).toHaveBeenCalledTimes(1);
      api.track('after');
      api.pageview('/other');
      await tick(600_000);
      await api.flush();
      expect(env().fetchMock).toHaveBeenCalledTimes(1);
      expect(env().warn).toHaveBeenCalled();
    });
  }

  it('413: sends half; a lone event that is too large is dropped', async () => {
    env().reply({ status: 413, body: { error: 'batch_too_large', message: 'x' } }, { status: 413 }, { status: 202 });
    const { api } = start();
    track(api, 7);
    await api.flush();
    expect(env().fetched.map((b: any) => b.events.length)).toEqual([8, 4, 2, 6]);
    expect(env().fetched.at(-1).events.map((e: any) => e.event_id)).toEqual(ids(env().fetched[0]).slice(2));
  });

  it('413 on a single event drops it and carries on', async () => {
    env().reply({ status: 413 }, { status: 202 });
    const { api } = start();
    await api.flush();
    api.track('next');
    await api.flush();
    expect(env().fetched.map((b: any) => b.events.length)).toEqual([1, 1]);
    expect(env().fetched[1].events[0].name).toBe('next');
  });

  it('429 honours Retry-After (seconds), keeping the events', async () => {
    env().reply({ status: 429, headers: { 'retry-after': '7' } }, { status: 202 });
    const { api } = start();
    await api.flush();
    await tick(6999);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
    expect(ids(env().fetched[1])).toEqual(ids(env().fetched[0]));
  });

  it('429 without Retry-After waits 300 seconds', async () => {
    env().reply({ status: 429 }, { status: 202 });
    const { api } = start();
    await api.flush();
    await tick(299_999);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
  });

  it('5xx: exponential backoff 2s, 4s, 8s with the same event ids and batch id', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // full jitter factor 1.0
    env().reply({ status: 503 }, { status: 500 }, { status: 502 }, { status: 202 });
    const { api } = start();
    await api.flush();
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    await tick(1999);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
    await tick(3999);
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(3);
    await tick(7999);
    expect(env().fetchMock).toHaveBeenCalledTimes(3);
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(4);
    const [a, b, c, d] = env().fetched;
    expect(ids(b)).toEqual(ids(a));
    expect(ids(c)).toEqual(ids(a));
    expect(ids(d)).toEqual(ids(a));
    expect(new Set(env().fetched.map((x: any) => x.batch_id)).size).toBe(1);
  });

  it('jitter keeps the wait within 50-100% of the base delay', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    env().reply({ status: 500 }, { status: 202 });
    const { api } = start();
    await api.flush();
    await tick(999);
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    await tick(1);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a network error is retried like a 5xx', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    env().reply({ fail: true }, { status: 202 });
    const { api } = start();
    await api.flush();
    await tick(2000);
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(2);
  });

  it('events tracked while backing off join the next attempt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    env().reply({ status: 500 }, { status: 202 });
    const { api } = start();
    await api.flush();
    api.track('during');
    await tick(2000);
    await settle();
    expect(env().fetched[1].events.map((e: any) => e.name)).toEqual(['$pageview', 'during']);
  });

  it('keeps at most 1000 events in memory (oldest dropped first)', async () => {
    env().reply({ status: 429, headers: { 'retry-after': '60' } }, { status: 202 });
    const { api } = start();
    track(api, 1100);
    await tick(60_000);
    await api.flush();
    const delivered = env().fetched.slice(1).flatMap((b: any) => b.events);
    expect(delivered).toHaveLength(1000);
    expect(delivered[0].properties.i).toBe(100);
    expect(delivered.at(-1).properties.i).toBe(1099);
  });
});

describe('page hide', () => {
  it('sends the queue by sendBeacon as text/plain with the key in the body', async () => {
    const { api } = start();
    api.track('last_words');
    hide(env());
    await tick(0);
    expect(env().beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = env().beacon.mock.calls[0];
    expect(url).toBe('https://in.useunion.dev/v1/web');
    expect(blob.type.toLowerCase()).toBe('text/plain;charset=utf-8');
    expect(env().beaconed[0].key).toBe('av_test');
    expect(env().beaconed[0].events.map((e: any) => e.name)).toEqual(['$pageview', 'last_words', '$page_leave']);
    await tick(30_000);
    expect(env().fetchMock).not.toHaveBeenCalled(); // handed over, not sent twice
    void api;
  });

  it('splits the beacon at 100 events (including events whose fetch is still in flight)', async () => {
    env().fetchMock.mockImplementation(() => new Promise(() => {}));
    const { api } = start();
    track(api, 250);
    hide(env());
    await tick(0);
    expect(env().beaconed.map((b: any) => b.events.length).sort((a: number, b: number) => b - a)).toEqual([100, 100, 52]);
  });

  it('keeps events the browser refuses and sends them by fetch later', async () => {
    env().beacon.mockImplementation(() => false);
    const { api } = start();
    api.track('kept');
    hide(env());
    await api.flush();
    expect(env().fetched.flatMap((b: any) => b.events).map((e: any) => e.name)).toEqual(['$pageview', 'kept', '$page_leave']);
  });

  it('falls back to fetch when sendBeacon does not exist', async () => {
    (env().win.navigator as any).sendBeacon = undefined;
    const { api } = start();
    hide(env());
    await settle();
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    void api;
  });

  it('does not beacon while backing off (events stay queued)', async () => {
    env().reply({ status: 500 });
    const { api } = start();
    await api.flush();
    api.track('queued');
    hide(env());
    expect(env().beacon).not.toHaveBeenCalled();
  });
});

describe('persisted queue (product_analytics)', () => {
  const pa = { mode: 'product_analytics' };

  it('persists unsent events on hide, capped at 200 with FIFO eviction', async () => {
    env().reply({ fail: true });
    const { api } = start(pa);
    await api.flush(); // first request fails -> backing off, nothing more is sent
    track(api, 249);
    hide(env());
    const stored = JSON.parse(env().win.localStorage.getItem('union:queue')!);
    expect(stored).toHaveLength(200);
    expect(stored.at(-1).name).toBe('$page_leave'); // newest kept
    expect(stored.at(-2).properties.i).toBe(248);
    expect(stored[0].properties.i).toBe(50); // 251 queued, the 51 oldest evicted
    expect(stored.every((e: any) => typeof e.session_id === 'string')).toBe(true);
  });

  it('resends them on the next page load with the same event ids, then clears storage', async () => {
    env().reply({ fail: true });
    const first = start(pa);
    await first.api.flush();
    first.api.track('survivor');
    hide(env());
    const persisted = JSON.parse(env().win.localStorage.getItem('union:queue')!).map((e: any) => e.event_id);
    expect(persisted.length).toBeGreaterThan(1);

    env().reply({ status: 202 });
    env().fetchMock.mockClear();
    env().fetched.length = 0;
    const second = createApi(config(pa)); // "reload": same storage, fresh SDK instance
    await second.api.flush();
    const sent = env().fetched.flatMap((b: any) => b.events.map((e: any) => e.event_id));
    for (const id of persisted) expect(sent).toContain(id);
    expect(env().win.localStorage.getItem('union:queue')).toBeNull();
  });

  it('clears the persisted queue when the queue is acknowledged', async () => {
    env().beacon.mockImplementation(() => false);
    const { api } = start(pa);
    hide(env());
    expect(env().win.localStorage.getItem('union:queue')).not.toBeNull();
    hide(env(), 'visible');
    await api.flush();
    expect(env().win.localStorage.getItem('union:queue')).toBeNull();
  });

  it('401 drops the persisted queue too', async () => {
    env().win.localStorage.setItem('union:queue', JSON.stringify([{ event_id: '01a17280-b500-7179-a2b7-000000000001', session_id: '01a17280-b500-7179-a2b7-000000000002', name: 'x', timestamp: 1 }]));
    env().reply({ status: 401 });
    const { api } = start(pa);
    await api.flush();
    expect(env().win.localStorage.getItem('union:queue')).toBeNull();
  });

  it('a corrupt persisted queue is ignored', async () => {
    env().win.localStorage.setItem('union:queue', '{not json');
    const { api } = start(pa);
    await api.flush();
    expect(env().fetched[0].events[0].name).toBe('$pageview');
  });
});
