# union-web

Browser analytics SDK for [Union](https://useunion.dev). One `<script>`, no dependencies, ~4.4 KB gzip, cookieless by default.

```html
<script defer src="https://cdn.useunion.dev/v0/u.js" data-key="av_xxx"></script>
```

That is the whole install: page views (including SPA navigation), time on page and scroll depth, outbound and download clicks.

## Script attributes

| Attribute | Default | Meaning |
|---|---|---|
| `data-key` | required | Client write key (`av_...`). Public by design; the project's domain allow-list is what protects it. |
| `data-mode` | `strict_anonymous` | `strict_anonymous` or `product_analytics` (see [Privacy modes](#privacy-modes)). |
| `data-version` | none | Your deploy/release id, becomes `device.app_version` (max 32 chars, longer is ignored with a warning). Feeds Releases. |
| `data-api` | `https://in.useunion.dev` | Endpoint base. Events go to `${data-api}/v1/web`. A relative value such as `/_union` sends them to your own domain ([first-party proxy](#first-party-proxy)). |
| `data-exclude` | none | Comma separated path globs, e.g. `/admin/*,/thanks`. `*` matches any characters (slashes included). Matching pages record nothing: no pageviews, no custom events, no clicks. |
| `data-env` | auto | Force `development` or `production`. Auto: `development` on `localhost`, `127.*`, `*.local`; otherwise `production`. |
| `data-auto` | on | `data-auto="false"` turns off `$outbound` / `$download` capture. Tagged elements (`data-union-event`) keep working. |
| `data-spa` | on | `data-spa="false"` stops patching `history.pushState/replaceState` and ignores `popstate`. |
| `data-consent` | none | `banner`: show Union's consent banner and collect only after **Accept**. `required`: collect only after your consent tool calls `union.consent(true)`. See [Consent](#consent). |
| `data-consent-title`, `-text`, `-accept`, `-decline`, `-policy` | English defaults | The banner's heading, sentence, button labels and privacy-policy URL. |

## What is recorded automatically

| Event | When | Properties |
|---|---|---|
| `$pageview` | on load and on every SPA navigation to a new path | `screen` = path (no query, no hash, max 128 chars). `page.hostname`; on the first pageview of a page load also `page.referrer` (host only, only when external) and `page.utm_source/medium/campaign/term/content` (max 128 each). |
| `$page_leave` | page hidden (`visibilitychange`, `pagehide`) and before an SPA navigation, for the page being left | `engaged_ms` (visible time on that page), `scroll_pct` (deepest scroll, integer 0-100) |
| `$outbound` | click on a link to another host | `url_host` |
| `$download` | click on a link to `.pdf .zip .dmg .exe .csv .xlsx .docx .pptx .mp4 .mp3 .pkg .apk .ipa` | `file_ext` |

Query strings and fragments never leave the browser, except the five UTM parameters that are lifted out on the first pageview.

### Tagged clicks without JavaScript

```html
<button data-union-event="signup_clicked" data-union-feature="onboarding" data-union-role="start">Sign up</button>
```

`data-union-event` must be lowercase snake_case. `data-union-feature` and `data-union-role` are optional.

## API

`window.union` is available as soon as the script has run. Every method never throws; invalid input is dropped (never truncated) with a `console.warn`.

```js
union.track('invoice_paid', { amount: 49, currency: 'EUR' });
union.track('export_done', { rows: 120 }, { feature: 'reports', role: 'success' });

const checkout = union.feature('checkout');
checkout.discovery();            // event "checkout_discovery"
checkout.start({ items: 2 });    // event "checkout_start"
checkout.success({ value: 49 }); // use / failure work the same
checkout.use('coupon_applied');  // pass a name first to choose the event name yourself

union.pageview('/virtual/path'); // manual pageview (deduplicated like automatic ones)
union.identify('user_42', { plan: 'pro' }); // product_analytics only
union.reset();                              // product_analytics only: forget the user, start a new session
union.optOut(); union.optIn();
union.sessionId();               // product_analytics: current session id; strict_anonymous: null
await union.flush();             // send the queue now
```

### Calls before the script has loaded

The script is `defer`red, so early calls need a queue. Put this before your own code:

```html
<script>window.union = window.union || function () { (union.q = union.q || []).push(arguments); };</script>
<script defer src="https://cdn.useunion.dev/v0/u.js" data-key="av_xxx"></script>
<script>union('track', 'early_event', { from: 'inline' });</script>
```

The SDK replays `union.q` in order right after the first pageview. The command form also works after load: `union('track', 'x')`, `union('feature', 'k').success()`.

### Limits (mirrors the wire contract)

Event names and feature keys: `^[a-z][a-z0-9_]*$`, max 64. Properties: max 32, key 1-64 chars, values `string` (max 256) / finite `number` / `boolean`. Traits: max 8, key max 40, string values max 256. User id: 1-128 chars. Roles: `discovery | start | use | success | failure`. Names starting with `$` are reserved.

## Privacy modes

### `strict_anonymous` (default)

Zero storage: no cookies, no `localStorage`, no `sessionStorage`, no IndexedDB. The batch carries no `session_id` and an empty `identity`. Sessions are assigned **server-side** from a daily-salted hash of IP and User-Agent, so `union.sessionId()` returns `null` until the first `202` arrives, then the server-assigned `session_id` from that response (kept in memory only, never stored). `identify()` and `reset()` are no-ops that log a warning. Nothing needs a consent banner for storage access.

The single exception: after you call `union.optOut()` the flag `union:optout` is written to `localStorage`. The SDK reads that one key on load (and only that key), which is how a strict site keeps honouring an opt-out.

### `product_analytics`

Uses `localStorage`; the site decides whether that needs consent, the SDK does not guess.

| Key | Content |
|---|---|
| `union:id` | `install_id` (UUID) |
| `union:session` | `{ id, startedAt, lastActivityAt }`; a new session starts after more than 30 minutes of inactivity (same rule as the server and the mobile SDKs) |
| `union:user` | identified user `{ id, traits? }` |
| `union:queue` | unsent events (max 200, oldest evicted) replayed on the next page load |
| `union:optout` | opt-out flag |
| `union:consent` | `granted` once the visitor accepted (`data-consent`) |

Every event carries `session_id`; the batch identity is `{ install_id, user_id?, traits? }`.

## Consent

For `product_analytics` in the EU (it stores an id in the browser), let the visitor decide first:

```html
<script defer src="https://cdn.useunion.dev/v0/u.js" data-key="av_xxx"
        data-mode="product_analytics" data-consent="banner"
        data-consent-policy="https://example.com/privacy"></script>
```

- Until the visitor answers, **nothing is stored and nothing is sent**. Page views and events wait in memory (at most 100) and are sent on **Accept** — the landing page keeps its referrer and UTMs.
- **Decline** calls `union.optOut()`: the waiting events are dropped and nothing is collected on later visits.
- The answer is remembered (`union:consent` or `union:optout`), so the banner shows once. Put `<a href="#" onclick="union.showConsent()">Privacy choices</a>` in the footer to let people change their mind.
- Accept and Decline have equal weight by design. The banner is `consent.js`, loaded from next to `u.js` only while an answer is pending; sites without `data-consent` never download it.
- Already have a consent tool (Cookiebot, OneTrust, Klaro)? Use `data-consent="required"` and call `union.consent(true)` / `union.consent(false)` from its callbacks — or `union('consent', true)` before the script has loaded.

`strict_anonymous` stores nothing and needs no banner; `data-consent` works there too if your policy asks for it (the only thing then written is the answer).

## Delivery

Events are queued in memory and sent every 5 s, at 20 events, and on `visibilitychange -> hidden` / `pagehide` (via `navigator.sendBeacon`). A batch is at most 100 events / 256 KB. Requests are `text/plain` with the key in the body, so they are CORS "simple requests" (no preflight) and `sendBeacon` works.

Server responses: `202` done; `400` naming events drops those events and resends the rest, other `400` drops the batch; `401`/`403` stop the SDK until the next page load; `413` splits the batch; `429` waits `Retry-After` (or 300 s); `5xx` and network errors retry with exponential backoff (2 s to 5 min, full jitter) keeping the same `event_id`s.

## First-party proxy

Serving the script and the endpoint from your own domain avoids ad-blocker lists and keeps the browser on one origin. Set `data-api` to the proxy prefix:

```html
<script defer src="/_union/u.js" data-key="av_xxx" data-api="/_union"></script>
```

The proxy must forward the **User-Agent**, the `Origin` header (domain allow-list) and the **client IP in `X-Forwarded-For`** (leftmost entry). Ingest hashes the cookieless visitor from that address and, behind a proxy, never uses the proxy's own address or country — without the header every visitor would collapse into one. Country behind a proxy comes from `x-union-country` (or Vercel's `x-vercel-ip-country`); without one the visit has no country rather than the proxy's.

### Next.js (`next.config.js`)

```js
module.exports = {
  async rewrites() {
    return [
      { source: '/_union/u.js', destination: 'https://cdn.useunion.dev/v0/u.js' },
      { source: '/_union/v1/web', destination: 'https://in.useunion.dev/v1/web' },
    ];
    // Vercel forwards X-Forwarded-For and x-vercel-ip-country itself. Self-hosted Next behind nginx:
    // make sure nginx sets X-Forwarded-For.
  },
};
```

### Cloudflare Worker (route `example.com/_union/*`)

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/_union/u.js') return fetch('https://cdn.useunion.dev/v0/u.js');
    if (url.pathname !== '/_union/v1/web') return new Response('Not found', { status: 404 });
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
    if (request.cf?.country) headers.set('x-union-country', String(request.cf.country));
    return fetch('https://in.useunion.dev/v1/web', { method: request.method, headers, body: request.body });
  },
};
```

## Revenue attribution (Stripe)

Union's Stripe source attributes revenue through Checkout metadata. Pass the ids from the page to your server and put them on the Checkout Session:

```js
// browser
const res = await fetch('/api/checkout', {
  method: 'POST',
  body: JSON.stringify({ unionSessionId: union.sessionId() }), // strict: null until the first 202, then the server session
});

// server (product_analytics: also pass your own user id)
const session = await stripe.checkout.sessions.create({
  // ...
  metadata: { union_session_id: unionSessionId, union_user_id: user.id },
});
```

In `strict_anonymous` `union.sessionId()` is the server-assigned session once the first batch was accepted (null before that, and null after a reload until the next 202).

## Development

```sh
pnpm install
pnpm check      # typecheck + build + size budget + tests
pnpm build      # dist/u.js, dist/u.js.map, dist/u.d.ts
pnpm test
```

The wire contract lives in `union-panel/packages/contract`; `test/fixtures/web-batch.v1.json` is a copy of its JSON Schema and every batch the tests send is validated against it. See `CLAUDE.md` and `docs/CHECKLIST.md`.
