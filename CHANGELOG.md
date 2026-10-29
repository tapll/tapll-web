# Changelog

## 0.4.0

- **Automation flag**: when `navigator.webdriver` is true (Puppeteer, Playwright, Selenium…), every batch carries `device.automation: true`. Union keeps such visits and marks them as bots — listed in Sessions, never counted in any metric — whatever User-Agent the automation claims. Nothing is sent for a regular browser.

## 0.3.0

- **First visit** (`product_analytics`): the page load that mints `union:id` sends `$first_open` once, in the session of the event that revealed it, so Union can start retention cohorts for websites. Never sent when the browser did not keep the id (blocked storage would make every load a first visit), never in `strict_anonymous`, and only after consent when `data-consent` is set. Visitors who already have an id are not counted as new.

## 0.2.1

- Consent banner redesign: a compact card (bottom-left; a full-width sheet on phones) with a heading, muted body text, two equal neutral buttons, hairline border, dark mode and a short entrance animation (off with `prefers-reduced-motion`). New `data-consent-title` (default "Your privacy"). Behaviour unchanged.

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
