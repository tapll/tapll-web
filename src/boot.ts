import { createApi, loadBanner } from './api';
import { readConfig } from './config';
import { warn } from './validation';

/** Boots the SDK from a `<script data-key=...>` element. Loading the script twice is a no-op. */
export function boot(script: Element | null): void {
  try {
    const w = window as any;
    // `tapll` is the name; `union` is the pre-rename alias, so pages written for it keep working.
    const stubs = [w.tapll, w.union].filter((s, i, a) => s && a.indexOf(s) === i);
    if (stubs.some((s) => s.version) || document.visibilityState === ('prerender' as string)) return;
    const cfg = readConfig(script, location.hostname);
    if (!cfg) return;
    const { api } = createApi(cfg);
    w.tapll = w.union = api;
    // Calls made through the `tapll.q` stub (or the old snippet's `union.q`) before this script loaded, in order.
    for (const s of stubs) for (const a of s.q || []) api(...(Array.prototype.slice.call(a) as [string]));
    // After the queue: a `tapll('consent', true)` made by the site's CMP before load is already applied.
    if (cfg.consent === 'banner' && api.consentStatus() === 'pending') loadBanner(cfg);
  } catch (e) {
    warn('failed to start: ' + e);
  }
}
