import { describe, expect, it } from 'vitest';
import { assertBatch, hide, pagehide, start, tick, useEnv } from './helpers';

const env = useEnv('https://shop.example.com/pricing?utm_source=ads&utm_medium=cpc', { referrer: 'https://duckduckgo.com/?q=analytics' });

/** Drives every kind of event through the SDK; useEnv's afterEach fails the test if any batch broke the contract. */
async function everything(attrs: Record<string, string>) {
  const { api } = start(attrs);
  const w = env().win as any;
  api.track('plain');
  api.track('with_props', { s: 'x', n: 1, b: true, f: 1.5, neg: -3 });
  api.track('in_feature', { a: 1 }, { feature: 'onboarding', role: 'start' });
  api.feature('checkout').success({ value: 10 });
  api.pageview('/virtual?x=1#y');
  w.history.pushState({}, '', '/docs/getting-started?tab=2');
  w.document.body.innerHTML = '<a id="o" href="https://other.org/a?b=1">o</a><a id="d" href="/files/a.pdf">d</a><button id="t" data-union-event="cta_clicked" data-union-feature="pricing" data-union-role="use">t</button>';
  for (const id of ['o', 'd', 't']) w.document.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await tick(3000);
  hide(env());
  await tick(0);
  hide(env(), 'visible');
  api.track('after_return');
  pagehide(env());
  await api.flush();
  await tick(0);
  return env().batches();
}

describe('every batch conforms to web-batch.v1.json', () => {
  for (const mode of ['strict_anonymous', 'product_analytics']) {
    it(`${mode}: all event kinds, fetch and beacon`, async () => {
      const batches = await everything({ mode, version: '1.0.0' });
      expect(batches.length).toBeGreaterThan(0);
      batches.forEach(assertBatch);
      const names = new Set(batches.flatMap((b) => b.events.map((e: any) => e.name)));
      for (const n of ['$pageview', '$page_leave', '$outbound', '$download', 'plain', 'with_props', 'in_feature', 'checkout_success', 'cta_clicked', 'after_return'])
        expect(names.has(n), n).toBe(true);
    });
  }

  it('product_analytics with identify: identity block validates', async () => {
    const { api } = start({ mode: 'product_analytics' });
    api.identify('user_1', { name: 'Ada', plan: 'pro' });
    api.track('x');
    await api.flush();
    assertBatch(env().fetched[0]);
    expect(env().fetched[0].identity).toMatchObject({ user_id: 'user_1', traits: { name: 'Ada', plan: 'pro' } });
  });

  it('automation: flagged only when navigator.webdriver is true, never sent as false', async () => {
    const plain = start({});
    plain.api.track('x');
    await plain.api.flush();
    expect('automation' in env().fetched[0].device).toBe(false);

    Object.defineProperty(env().win.navigator, 'webdriver', { value: true, configurable: true });
    const driven = start({});
    driven.api.track('y');
    await driven.api.flush();
    const last = env().fetched.at(-1);
    assertBatch(last);
    expect(last.device.automation).toBe(true);
  });

  it('event order is chronological and ids are unique', async () => {
    const batches = await everything({});
    const evs = batches.flatMap((b) => b.events);
    expect(new Set(evs.map((e: any) => e.event_id)).size).toBe(evs.length);
    const ts = evs.map((e: any) => e.timestamp);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('the validator itself rejects contract violations (negative controls)', async () => {
    const { api } = start({});
    await api.flush();
    const good = env().fetched[0];
    expect(() => assertBatch(good)).not.toThrow();
    const clone = () => JSON.parse(JSON.stringify(good));
    const cases: Record<string, (b: any) => void> = {
      'unknown key': (b) => (b.nope = 1),
      'null value': (b) => (b.device.app_version = null),
      'bad uuid': (b) => (b.events[0].event_id = 'x'),
      'session_id in strict': (b) => (b.events[0].session_id = b.batch_id),
      'install_id in strict': (b) => (b.identity = { install_id: b.batch_id }),
      'query in screen': (b) => (b.events[0].screen = '/a?b=1'),
      'page on a non-pageview': (b) => ((b.events[0].name = 'x'), (b.events[0].page = { hostname: 'a' })),
      'testflight env': (b) => (b.environment = 'testflight'),
      'no events': (b) => (b.events = []),
    };
    for (const [label, mutate] of Object.entries(cases)) {
      const b = clone();
      mutate(b);
      expect(() => assertBatch(b), label).toThrow();
    }
  });
});
