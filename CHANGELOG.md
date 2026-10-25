# Changelog

## 0.2.0

- **Consent** (`data-consent`). `required`: nothing is stored and nothing is sent until `union.consent(true)` — events wait in memory (max 100) and leave on accept, with the landing page's referrer and UTMs; `union.consent(false)` is `optOut()`. `banner`: the same, plus Union's own banner (`consent.js`, ~1.1 KB, loaded next to `u.js` only while the answer is pending): Accept and Decline with equal weight, text and policy link from `data-consent-text`, `data-consent-accept`, `data-consent-decline`, `data-consent-policy`. The answer is remembered (`union:consent` / `union:optout`).
- `union.consentStatus()`, `union.showConsent()` (re-open the banner from a footer link).
- Size budget 5 KB gzip (consent gate ~0.4 KB).

## 0.1.0

First release.

- `strict_anonymous` (zero storage, server-side sessions) and `product_analytics` (`localStorage` install id, 30-minute sessions, `identify`/`reset`, persisted queue).
- Automatic `$pageview` (load + SPA), `$page_leave` (engaged time, scroll depth), `$outbound`, `$download`; `data-union-event` tagged clicks.
- `window.union` API with pre-load `union.q` replay, `feature()` handles, `optOut`/`optIn`, `sessionId()`, `flush()`.
- Batching (5 s / 20 events / page hide, 100 events or 256 KB per batch), `sendBeacon` on hide, full response policy with backoff.
- Script attributes: `data-key`, `data-mode`, `data-version`, `data-api`, `data-exclude`, `data-env`, `data-auto`, `data-spa`.
