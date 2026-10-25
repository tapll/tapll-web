import { createApi, loadBanner } from './api';
import { readConfig } from './config';
import { warn } from './validation';

/** Boots the SDK from a `<script data-key=...>` element. Loading the script twice is a no-op. */
export function boot(script: Element | null): void {
  try {
    const prev = (window as any).union;
    if ((prev && prev.version) || document.visibilityState === ('prerender' as string)) return;
    const cfg = readConfig(script, location.hostname);
    if (!cfg) return;
    const { api } = createApi(cfg);
    (window as any).union = api;
    // Calls made through the `union.q` stub before this script loaded, in order.
    for (const a of (prev && prev.q) || []) api(...(Array.prototype.slice.call(a) as [string]));
    // After the queue: a `union('consent', true)` made by the site's CMP before load is already applied.
    if (cfg.consent === 'banner' && api.consentStatus() === 'pending') loadBanner(cfg);
  } catch (e) {
    warn('failed to start: ' + e);
  }
}
