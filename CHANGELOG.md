# Changelog

## 0.1.0

First release.

- `strict_anonymous` (zero storage, server-side sessions) and `product_analytics` (`localStorage` install id, 30-minute sessions, `identify`/`reset`, persisted queue).
- Automatic `$pageview` (load + SPA), `$page_leave` (engaged time, scroll depth), `$outbound`, `$download`; `data-union-event` tagged clicks.
- `window.union` API with pre-load `union.q` replay, `feature()` handles, `optOut`/`optIn`, `sessionId()`, `flush()`.
- Batching (5 s / 20 events / page hide, 100 events or 256 KB per batch), `sendBeacon` on hide, full response policy with backoff.
- Script attributes: `data-key`, `data-mode`, `data-version`, `data-api`, `data-exclude`, `data-env`, `data-auto`, `data-spa`.
