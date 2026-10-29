import { createState, K, store, type User } from './session';
import { createTransport } from './transport';
import type { Config, EmitOptions, WebEvent } from './types';
import { uuid } from './uuid';
import { PATH_MAX } from './validation';
import { VERSION } from './version';

/** Builds events and batches and owns identity/session/opt-out state. Input is already validated by the API layer. */
export function createCore(cfg: Config) {
  const pa = cfg.mode === 'product_analytics';
  const st = pa ? createState() : null;
  let opted = store.get(K.optout) === '1';
  let serverSession: string | null = null; // strict_anonymous: assigned by the server, memory only
  // Consent mode: until the visitor accepts, nothing is stored and nothing is sent. Events wait here,
  // in memory only, and leave on `consent(true)`; a decline drops them. The choice itself is the one
  // thing written, and only once the visitor made it.
  let pending = cfg.consent !== 'none' && !opted && store.get(K.consent) !== 'granted';
  let held: WebEvent[] = [];
  let heldUser: User | null | undefined;
  const HELD_MAX = 100;

  const tx = createTransport({
    url: cfg.url,
    persist: pa,
    accepted(b) {
      if (!pa && b && typeof b.session_id === 'string') serverSession = b.session_id;
    },
    build(events, batch_id) {
      const device: Record<string, unknown> = { os_name: 'Web', sdk_version: VERSION, app_version: cfg.version, locale: (navigator.language || 'en').slice(0, 16), screen_width: Math.round(innerWidth) };
      device.timezone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 64);
      // Puppeteer, Playwright and Selenium set it whatever User-Agent they claim; the server marks the visit a bot.
      if (navigator.webdriver === true) device.automation = true;
      const u = st && st.user();
      // JSON.stringify omits undefined, so absent keys are never sent (never null).
      const identity = st ? { install_id: st.installId(), user_id: u ? u.id : undefined, traits: u ? u.traits : undefined } : {};
      return { contract_version: 1, batch_id, environment: cfg.env, privacy_mode: cfg.mode, sent_at: Date.now(), key: cfg.key, device, identity, events };
    },
  });
  if (!opted && !pending) tx.restore();
  function optOut(): void {
    opted = true;
    pending = false;
    held = [];
    store.set(K.optout, '1');
    store.del(K.consent);
    tx.clear();
    if (pa) store.del(K.queue);
  }
  const send = (e: WebEvent): void => {
    e.session_id = st ? st.touch() : undefined;
    // The web's first open (the server starts retention cohorts from it), ahead of the event that
    // revealed it and in its session. After consent, since `send` never runs while it is pending.
    if (st && st.takeFirstVisit()) tx.push({ event_id: uuid(7), name: '$first_open', timestamp: e.timestamp, session_id: e.session_id });
    tx.push(e);
  };

  return {
    cfg,
    tx,
    /** Queues one event. `screen` defaults to the current path; excluded paths and opt-out suppress it. */
    emit(name: string, o: EmitOptions = {}): void {
      const path = o.screen === undefined ? location.pathname : o.screen;
      if (opted || tx.stopped || cfg.exclude.some((r) => r.test(path))) return;
      const e: WebEvent = {
        event_id: uuid(7),
        name,
        timestamp: Date.now(),
        screen: path[0] === '/' && path.length <= PATH_MAX ? path : undefined,
        properties: o.props,
        feature: o.feature,
        role: o.role,
        page: o.page,
      };
      if (pending) held.length < HELD_MAX && held.push(e);
      else send(e);
    },
    identify: (u: User): void => (pending ? void (heldUser = u) : st!.setUser(u)),
    reset(): void {
      st!.setUser(null);
      st!.rotate();
    },
    sessionId: (): string | null => (st ? st.touch() : serverSession),
    optOut,
    optIn(): void {
      opted = false;
      store.del(K.optout);
    },
    /** The visitor's answer. Accept releases what waited; decline is `optOut()`. Both are remembered. */
    consent(granted: boolean): void {
      if (!granted) return optOut();
      store.set(K.consent, 'granted');
      store.del(K.optout);
      const wasPending = pending;
      opted = pending = false;
      if (!wasPending) return;
      tx.restore();
      if (heldUser !== undefined && st) st.setUser(heldUser);
      const out = held;
      held = [];
      out.forEach(send);
    },
    consentStatus: (): 'granted' | 'denied' | 'pending' | 'not_required' =>
      opted ? 'denied' : pending ? 'pending' : cfg.consent === 'none' ? 'not_required' : 'granted',
  };
}

export type Core = ReturnType<typeof createCore>;
