# union-web — implementation checklist

One place that says **what the SDK sends, when and in what shape**. Before adding an event or a context field: find it here; if it is missing, add a row first, then implement.

Source of truth for the wire shape: `packages/contract/src/web-batch.ts` in `union-panel` (JSON Schema copy: `test/fixtures/web-batch.v1.json`). This file does not define the contract, it describes what we emit from it. Mirrors `union-ios/docs/CHECKLIST.md`; **`[WEB]`** marks where the browser differs from iOS.

State: `[x]` implemented and covered by a test, `[ ]` not done.

## 1. Automatic events

| Event | When | Properties / fields | State |
|---|---|---|---|
| `$pageview` | script load; SPA navigation to a new path (`pushState`, `replaceState`, `popstate`); `union.pageview(path?)` | `screen` = path. `page.hostname` always; first pageview of the page load only: `page.referrer` (external host), `page.utm_*` | [x] |
| `$page_leave` | `visibilitychange -> hidden`, `pagehide`, and before an SPA navigation (for the previous path) | `screen` = path left; `engaged_ms`, `scroll_pct` (0-100 integer, deepest scroll) | [x] |
| `$outbound` | click on a link (`http/https`) to another host (`www.` ignored) | `url_host` | [x] |
| `$download` | click on a link whose path ends in pdf, zip, dmg, exe, csv, xlsx, docx, pptx, mp4, mp3, pkg, apk, ipa (any host) | `file_ext` (lowercase) | [x] |
| tagged | click inside `[data-union-event]` | name from the attribute; `feature`/`role` from `data-union-feature`/`data-union-role` | [x] |

- [WEB] `$first_open` (`product_analytics` only): once, on the page load that minted `union:id` and only if storage kept it; in the session of the event that revealed it, ahead of it; after consent. iOS sends it on the first launch after install.
- [WEB] No `$app_install`, `$app_update`, `$session_start/end`, `$foreground/$background`, `$screen_view`, `$deep_link`: the contract refuses them on `/v1/web`. Sessions are the server's in strict mode.
- [WEB] `$pageview`/`$page_leave` replace `$screen_view`/`$background`; the path is the screen.
- [WEB] `page` (hostname, referrer, utm) exists on `$pageview` only. Referrer is a host, never a URL; same-site (including `www.`) referrers are omitted. UTM values over 128 chars are omitted, not truncated.
- [WEB] Paths: `location.pathname`; query and hash are never sent; a path over 128 chars is skipped with a warning (no event).
- [WEB] `$page_leave` is emitted once per visit to a page (a `visibilitychange` followed by `pagehide` is one event); returning to a hidden tab starts a new engagement segment.
- Every event has a UUIDv7 `event_id`; a retry keeps it.

## 2. Public API

| Call | Behaviour | State |
|---|---|---|
| `track(name, props?, {feature, role}?)` | validates, emits with `screen` = current path | [x] |
| `feature(key)` | `{discovery,start,use,success,failure}(props?)` emit `<key>_<role>`; a string first argument names the event | [x] |
| `pageview(path?)` | manual pageview, deduplicated | [x] |
| `identify(userId, traits?)` / `reset()` | product_analytics only; no-op + warning in strict | [x] |
| `optOut()` / `optIn()` | flag in `union:optout`; opted out = nothing sent, queue dropped | [x] |
| `[WEB]` `data-consent` / `consent(bool)` | pending: no storage, no network, events held in memory (≤100) and released on accept with their session; decline = `optOut()`; answer remembered in `union:consent`; `banner` loads `consent.js` (Accept/Decline equal weight) | [x] |
| `sessionId()` | product_analytics: live session id; strict: `session_id` of the latest 202 (memory only), `null` until then | [x] |
| `flush()` | resolves when the queue is empty or the SDK is paused/stopped | [x] |
| `union.q` stub | replayed in order after the first pageview | [x] |
| double load | second load is a no-op | [x] |

- [WEB] `feature().use(props?)` takes no event name by default (the browser API in the brief); the RN-style `use('name', props?)` is also accepted.
- [WEB] No `screen()` call, no `setAnalyticsCollectionEnabled`, no crash/error APIs (out of scope, ADR 0005).
- Never throws: bad input is dropped with `console.warn`.

## 3. Validation (mirrors `limits.ts`)

Event name / feature key `^[a-z][a-z0-9_]*$` max 64 and no `$` prefix; role in the five roles; properties max 32, key 1-64, value string<=256 / finite number / boolean; traits max 8, key<=40, string<=256; user id 1-128. Invalid = event (or identify) dropped, never truncated. [x]

## 4. Batch

`{contract_version:1, batch_id (v4), environment, privacy_mode, sent_at, key, device, identity, events}`. [x]

- [WEB] `device` = `{os_name:'Web', sdk_version, app_version? (data-version), locale (navigator.language), timezone (Intl), screen_width, automation?}`. No `app_build`, `device_model`, `os_version` (the server reads them from the User-Agent). `automation: true` only when `navigator.webdriver === true` (never `false`); the server keeps the visit and marks it a bot (≥ 0.4.0).
- [WEB] `environment` is `development | production` (localhost, `127.*`, `*.local`, or `data-env`); there is no `testflight`.
- [WEB] `key` is in the body (and only there): `sendBeacon` cannot set headers and `text/plain` keeps the request CORS-simple.
- Absent keys are omitted, never `null`.

## 5. Privacy modes

| | strict_anonymous | product_analytics |
|---|---|---|
| storage | none (only `union:optout` after `optOut()`) | `union:id`, `union:session`, `union:user`, `union:queue`, `union:optout` |
| `session_id` | absent (server assigns) | on every event, 30 min inactivity rule |
| identity | `{}` | `{install_id, user_id?, traits?}` |
| identify / reset | no-op + warning | persisted / clears user + new session |
| unsent events survive reload | no | yes (`union:queue`, max 200, FIFO) |

[x] covered by `test/privacy.test.ts`, `test/session.test.ts`.

- [WEB] iOS keeps `install_id` in the Keychain and `reset()` keeps it too; here it is `localStorage`, so clearing site data resets it.
- [WEB] `identify()` does not rotate the session (only `reset()` does).
- [WEB] The session snapshot is re-read from storage on every event so several tabs share one session.

## 6. Delivery

| Rule | State |
|---|---|
| memory queue, cap 1000 (oldest dropped) | [x] |
| flush every 5 s, at 20 events, on `visibilitychange -> hidden` and `pagehide` | [x] |
| max 100 events / 256 KB per batch (split) | [x] |
| page hide: `sendBeacon(url, Blob text/plain;charset=UTF-8)`, refused events stay queued (persisted in product_analytics) | [x] |
| otherwise `fetch` POST, `text/plain`, `credentials:'omit'`, `keepalive` when the body is under 60 KB | [x] |
| retry keeps `event_id`s (and the `batch_id` while the batch is unchanged) | [x] |

Response policy (`src/policy.ts`, from `ServerResponse.swift`):

| Status | Action |
|---|---|
| 202 | done |
| 400, details `events.<i>...` only | drop those events, resend the rest at once (each round removes at least one event, so it terminates) |
| 400, envelope detail / `privacy_violation` / no event paths / unparsable | drop the batch |
| 401 | stop for the page load |
| 403 | stop for the page load [WEB: iOS pauses an hour; a page load is the browser's equivalent, and `origin_not_allowed` will not fix itself] |
| 413 | split in half (a single oversized event is dropped) |
| 429 | wait `Retry-After` seconds or 300 s (capped at 1 h) |
| 5xx / network / anything else | exponential backoff 2 s ... 5 min, jitter 0.5-1.0 |

All [x] (`test/transport.test.ts`, `test/policy.test.ts`).

- [WEB] A 400 with event paths is resent without the "once" limit: every round removes at least one named event, so it ends.
- [WEB] 401/403 also clear the persisted queue.

## 7. Suppression

`data-exclude` globs and opt-out suppress everything (events, leaves, tagged clicks). The check uses the path of the event (the previous path for a `$page_leave` sent on navigation). [x]

[WEB] Do Not Track is not read.

## 8. Size budget

Original target: **3 KB gzip**. The full feature set above measures about 4.4 KB, so 0.1.0 enforced **4.5 KB**; 0.2.0 adds the consent gate (~0.4 KB) and `scripts/budget.mjs` enforces **5 KB** (the banner is a separate `consent.js`). To get back to 3 KB the candidates are, by size: persisted queue + restore (~250 B), `$page_leave` scroll tracking (~150 B), `feature()` handles (~150 B), 413 split and 400 per-event drop (~250 B), `data-exclude` globs, UTM/referrer context. Decide with product before cutting.
