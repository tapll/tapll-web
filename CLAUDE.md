# union-web — rules for agents

Browser SDK for Union (`POST /v1/web`). Sibling of `union-ios`, `union-android`, `union-react-native`. TypeScript, zero runtime dependencies, one IIFE `dist/u.js`.

**Read `docs/CHECKLIST.md` before changing behaviour.** It lists what the SDK sends, when, and where web differs from iOS (`[WEB]`). A behaviour change without a checklist update is unfinished.

Hard rules:

- **The contract is not defined here.** It lives in `union-panel/packages/contract` (`web-batch.ts`, `event-batch.ts`, `limits.ts`, ADR `docs/Engineering/ADR/0005-web-platform.md`). `test/fixtures/web-batch.v1.json` is a **copy** of the generated JSON Schema: never hand-edit it, re-copy it when the contract changes. Every batch in every test is validated against it (`test/helpers.ts`).
- **Never throw into the page.** Every public call goes through the dispatcher in `src/api.ts`; auto-capture handlers go through `guard()` in `src/autocapture.ts`. Invalid input is dropped with `console.warn`, never truncated. No other console output.
- **`strict_anonymous` uses zero storage**: no cookie, `localStorage`, `sessionStorage`, IndexedDB. The only allowed touch is reading `union:optout` and (after an explicit `optOut()`) writing it. No `session_id`, `identity` is `{}`. `test/privacy.test.ts` enforces this; do not weaken it.
- `product_analytics` storage keys are `union:id`, `union:session`, `union:user`, `union:queue`, `union:optout` only (`src/session.ts` `K`).
- Never send `null`; omit absent keys. A retry keeps the same `event_id`s. `$...` event names come only from the contract's `AutoEventName`.
- Page paths are `location.pathname` only (no `?`/`#`, max 128). Page context (`page`) rides on `$pageview` only; referrer/UTM only on the first pageview of a page load.
- Size budget: `scripts/budget.mjs` (gzip, enforced by `pnpm check` and `test/size.test.ts`). Watch it; avoid object spread / optional chaining (ES2017 target adds polyfill helpers).

Commands: `pnpm install`, `pnpm check` (typecheck + build + size + tests), `pnpm test`, `pnpm build`.

Code layout: `config` (script attributes) · `validation` (limits) · `session` (storage, sessions, identity) · `uuid` · `policy` (response decisions, backoff) · `transport` (queue, batching, retry, beacon) · `core` (event/batch building, opt-out) · `autocapture` (pageviews, leave, clicks) · `api` (public surface) · `boot` (attributes -> API, `union.q` replay, double-load guard) · `index` (entry).

Tests: vitest, a fresh happy-dom `Window` per test installed as globals (`test/helpers.ts`), fake timers. User-facing strings and logs in English; docs may be Polish or English.
