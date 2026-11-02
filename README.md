# tapll-web

Browser analytics SDK for [Tapll](https://tapll.com). One `<script>`, no dependencies, ~4.4 KB gzip, cookieless by default.

```html
<script defer src="https://cdn.tapll.com/v0/u.js" data-key="av_xxx"></script>
```

That is the whole install: page views (including SPA navigation), time on page and scroll depth, outbound and download clicks.

## Script attributes

| Attribute | Default | Meaning |
|---|---|---|
| `data-key` | required | Client write key (`av_...`). Public by design; the project's domain allow-list is what protects it. |
| `data-mode` | `strict_anonymous` | `strict_anonymous` or `product_analytics` (see [Privacy modes](#privacy-modes)). |
| `data-version` | none | Your deploy/release id, becomes `device.app_version` (max 32 chars, longer is ignored with a warning). Feeds Releases. |
| `data-api` | `https://in.tapll.com` | Endpoint base. Events go to `${data-api}/v1/web`. A relative value such as `/_tapll` sends them to your own domain ([first-party proxy](#first-party-proxy)). |
| `data-exclude` | none | Comma separated path globs, e.g. `/admin/*,/thanks`. `*` matches any characters (slashes included). Matching pages record nothing: no pageviews, no custom events, no clicks. |
| `data-env` | auto | Force `development` or `production`. Auto: `development` on `localhost`, `127.*`, `*.local`; otherwise `production`. |
| `data-auto` | on | `data-auto="false"` turns off `$outbound` / `$download` capture. Tagged elements (`data-tapll-event`) keep working. |
| `data-spa` | on | `data-spa="false"` stops patching `history.pushState/replaceState` and ignores `popstate`. |
| `data-consent` | none | `banner`: show Tapll's consent banner and collect only after **Accept**. `required`: collect only after your consent tool calls `tapll.consent(true)`. See [Consent](#consent). |
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
<button data-tapll-event="signup_clicked" data-tapll-feature="onboarding" data-tapll-role="start">Sign up</button>
```

`data-tapll-event` must be lowercase snake_case. `data-tapll-feature` and `data-tapll-role` are optional.

## API

`window.tapll` is available as soon as the script has run. Every method never throws; invalid input is dropped (never truncated) with a `console.warn`.

```js
tapll.track('invoice_paid', { amount: 49, currency: 'EUR' });
tapll.track('export_done', { rows: 120 }, { feature: 'reports', role: 'success' });

const checkout = tapll.feature('checkout');
checkout.discovery();            // event "checkout_discovery"
checkout.start({ items: 2 });    // event "checkout_start"
checkout.success({ value: 49 }); // use / failure work the same
checkout.use('coupon_applied');  // pass a name first to choose the event name yourself

tapll.pageview('/virtual/path'); // manual pageview (deduplicated like automatic ones)
tapll.identify('user_42', { plan: 'pro' }); // product_analytics only
tapll.reset();                              // product_analytics only: forget the user, start a new session
tapll.optOut(); tapll.optIn();
tapll.sessionId();               // product_analytics: current session id; strict_anonymous: null
await tapll.flush();             // send the queue now
```

### Calls before the script has loaded

The script is `defer`red, so early calls need a queue. Put this before your own code:

```html
<script>window.tapll = window.tapll || function () { (tapll.q = tapll.q || []).push(arguments); };</script>
<script defer src="https://cdn.tapll.com/v0/u.js" data-key="av_xxx"></script>
<script>tapll('track', 'early_event', { from: 'inline' });</script>
```

The SDK replays `tapll.q` in order right after the first pageview. The command form also works after load: `tapll('track', 'x')`, `tapll('feature', 'k').success()`.

### Coming from Union (pre-0.5.0)

The product was renamed Union to Tapll. Nothing has to change on a page at once:

- `window.union` stays an alias of `window.tapll` (same object), so `union.track(...)` keeps working. An old `window.union = ... union.q` snippet is drained by the new script too.
- `data-union-event` / `-feature` / `-role` are still read when the `data-tapll-*` attribute is absent.
- On load the SDK moves `union:id|session|user|queue|optout|consent` to `tapll:*` once (the new key wins if both exist, the old one is removed), so returning visitors keep their id (no new `$first_open`), opt-out and consent. In `strict_anonymous` only `optout` (and `consent` with `data-consent`) is touched; with consent pending nothing moves until the visitor accepts.
- Scripts embedded from the old `cdn.useunion.dev` host keep working; new installs use `cdn.tapll.com`.

### Limits (mirrors the wire contract)

Event names and feature keys: `^[a-z][a-z0-9_]*$`, max 64. Properties: max 32, key 1-64 chars, values `string` (max 256) / finite `number` / `boolean`. Traits: max 8, key max 40, string values max 256. User id: 1-128 chars. Roles: `discovery | start | use | success | failure`. Names starting with `$` are reserved.

## Privacy modes

### `strict_anonymous` (default)

Zero storage: no cookies, no `localStorage`, no `sessionStorage`, no IndexedDB. The batch carries no `session_id` and an empty `identity`. Sessions are assigned **server-side** from a daily-salted hash of IP and User-Agent, so `tapll.sessionId()` returns `null` until the first `202` arrives, then the server-assigned `session_id` from that response (kept in memory only, never stored). `identify()` and `reset()` are no-ops that log a warning. Nothing needs a consent banner for storage access.

The single exception: after you call `tapll.optOut()` the flag `tapll:optout` is written to `localStorage`. The SDK reads that one key on load (and only that key), which is how a strict site keeps honouring an opt-out.

### `product_analytics`

Uses `localStorage`; the site decides whether that needs consent, the SDK does not guess.

| Key | Content |
|---|---|
| `tapll:id` | `install_id` (UUID). The page load that creates it sends `$first_open` once: the visitor's first visit in this browser, where retention cohorts start |
| `tapll:session` | `{ id, startedAt, lastActivityAt }`; a new session starts after more than 30 minutes of inactivity (same rule as the server and the mobile SDKs) |
| `tapll:user` | identified user `{ id, traits? }` |
| `tapll:queue` | unsent events (max 200, oldest evicted) replayed on the next page load |
| `tapll:optout` | opt-out flag |
| `tapll:consent` | `granted` once the visitor accepted (`data-consent`) |

Every event carries `session_id`; the batch identity is `{ install_id, user_id?, traits? }`.

## Consent

For `product_analytics` in the EU (it stores an id in the browser), let the visitor decide first:

```html
<script defer src="https://cdn.tapll.com/v0/u.js" data-key="av_xxx"
        data-mode="product_analytics" data-consent="banner"
        data-consent-policy="https://example.com/privacy"></script>
```

- Until the visitor answers, **nothing is stored and nothing is sent**. Page views and events wait in memory (at most 100) and are sent on **Accept** — the landing page keeps its referrer and UTMs.
- **Decline** calls `tapll.optOut()`: the waiting events are dropped and nothing is collected on later visits.
- The answer is remembered (`tapll:consent` or `tapll:optout`), so the banner shows once. Put `<a href="#" onclick="tapll.showConsent()">Privacy choices</a>` in the footer to let people change their mind.
- Accept and Decline have equal weight by design. The banner is `consent.js`, loaded from next to `u.js` only while an answer is pending; sites without `data-consent` never download it.
- Already have a consent tool (Cookiebot, OneTrust, Klaro)? Use `data-consent="required"` and call `tapll.consent(true)` / `tapll.consent(false)` from its callbacks — or `tapll('consent', true)` before the script has loaded.

`strict_anonymous` stores nothing and needs no banner; `data-consent` works there too if your policy asks for it (the only thing then written is the answer).

## Delivery

Events are queued in memory and sent every 5 s, at 20 events, and on `visibilitychange -> hidden` / `pagehide` (via `navigator.sendBeacon`). A batch is at most 100 events / 256 KB. Requests are `text/plain` with the key in the body, so they are CORS "simple requests" (no preflight) and `sendBeacon` works.

Server responses: `202` done; `400` naming events drops those events and resends the rest, other `400` drops the batch; `401`/`403` stop the SDK until the next page load; `413` splits the batch; `429` waits `Retry-After` (or 300 s); `5xx` and network errors retry with exponential backoff (2 s to 5 min, full jitter) keeping the same `event_id`s.

## First-party proxy

Serving the script and the endpoint from your own domain avoids ad-blocker lists and keeps the browser on one origin. Set `data-api` to the proxy prefix:

```html
<script defer src="/_tapll/u.js" data-key="av_xxx" data-api="/_tapll"></script>
```

The proxy must forward the **User-Agent**, the `Origin` header (domain allow-list) and the **client IP in `X-Forwarded-For`** (leftmost entry). Ingest hashes the cookieless visitor from that address and, behind a proxy, never uses the proxy's own address or country — without the header every visitor would collapse into one. Country behind a proxy comes from `x-tapll-country` (or Vercel's `x-vercel-ip-country`); without one the visit has no country rather than the proxy's.

### Next.js (`next.config.js`)

```js
module.exports = {
  async rewrites() {
    return [
      { source: '/_tapll/u.js', destination: 'https://cdn.tapll.com/v0/u.js' },
      { source: '/_tapll/v1/web', destination: 'https://in.tapll.com/v1/web' },
    ];
    // Vercel forwards X-Forwarded-For and x-vercel-ip-country itself. Self-hosted Next behind nginx:
    // make sure nginx sets X-Forwarded-For.
  },
};
```

### Cloudflare Worker (route `example.com/_tapll/*`)

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/_tapll/u.js') return fetch('https://cdn.tapll.com/v0/u.js');
    if (url.pathname !== '/_tapll/v1/web') return new Response('Not found', { status: 404 });
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
    if (request.cf?.country) headers.set('x-tapll-country', String(request.cf.country));
    return fetch('https://in.tapll.com/v1/web', { method: request.method, headers, body: request.body });
  },
};
```

## Revenue attribution (Stripe)

Tapll's Stripe source attributes revenue through Checkout metadata. Pass the ids from the page to your server and put them on the Checkout Session:

```js
// browser
const res = await fetch('/api/checkout', {
  method: 'POST',
  body: JSON.stringify({ tapllSessionId: tapll.sessionId() }), // strict: null until the first 202, then the server session
});

// server (product_analytics: also pass your own user id)
const session = await stripe.checkout.sessions.create({
  // ...
  metadata: { tapll_session_id: tapllSessionId, tapll_user_id: user.id },
});
```

In `strict_anonymous` `tapll.sessionId()` is the server-assigned session once the first batch was accepted (null before that, and null after a reload until the next 202).

## Development

```sh
pnpm install
pnpm check      # typecheck + build + size budget + tests
pnpm build      # dist/u.js, dist/u.js.map, dist/u.d.ts
pnpm test
```

The wire contract lives in `union-panel/packages/contract`; `test/fixtures/web-batch.v1.json` is a copy of its JSON Schema and every batch the tests send is validated against it. See `CLAUDE.md` and `docs/CHECKLIST.md`.
