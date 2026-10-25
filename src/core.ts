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

  const tx = createTransport({
    url: cfg.url,
    persist: pa,
    accepted(b) {
      if (!pa && b && typeof b.session_id === 'string') serverSession = b.session_id;
    },
    build(events, batch_id) {
      const device: Record<string, unknown> = { os_name: 'Web', sdk_version: VERSION, app_version: cfg.version, locale: (navigator.language || 'en').slice(0, 16), screen_width: Math.round(innerWidth) };
      device.timezone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 64);
      const u = st && st.user();
      // JSON.stringify omits undefined, so absent keys are never sent (never null).
      const identity = st ? { install_id: st.installId(), user_id: u ? u.id : undefined, traits: u ? u.traits : undefined } : {};
      return { contract_version: 1, batch_id, environment: cfg.env, privacy_mode: cfg.mode, sent_at: Date.now(), key: cfg.key, device, identity, events };
    },
  });
  if (!opted) tx.restore();

  return {
    cfg,
    tx,
    /** Queues one event. `screen` defaults to the current path; excluded paths and opt-out suppress it. */
    emit(name: string, o: EmitOptions = {}): void {
      const path = o.screen === undefined ? location.pathname : o.screen;
      if (opted || tx.stopped || cfg.exclude.some((r) => r.test(path))) return;
      const e: WebEvent = {
        event_id: uuid(7),
        session_id: st ? st.touch() : undefined,
        name,
        timestamp: Date.now(),
        screen: path[0] === '/' && path.length <= PATH_MAX ? path : undefined,
        properties: o.props,
        feature: o.feature,
        role: o.role,
        page: o.page,
      };
      tx.push(e);
    },
    identify: (u: User): void => st!.setUser(u),
    reset(): void {
      st!.setUser(null);
      st!.rotate();
    },
    sessionId: (): string | null => (st ? st.touch() : serverSession),
    optOut(): void {
      opted = true;
      store.set(K.optout, '1');
      tx.clear();
      if (pa) store.del(K.queue);
    },
    optIn(): void {
      opted = false;
      store.del(K.optout);
    },
  };
}

export type Core = ReturnType<typeof createCore>;
