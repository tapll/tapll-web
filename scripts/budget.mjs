/**
 * Gzip budget for dist/u.js in bytes. One place, read by `pnpm size` and by test/size.test.ts.
 *
 * The original target was 3 KB (3072). The full 0.1.0 feature set (strict + product_analytics, SPA pageviews,
 * $page_leave with scroll/engagement, outbound/download/tagged clicks, retry + response policy, persisted
 * queue, never-throw API) measured about 4.4 KB; 0.2.0 adds the consent gate (`data-consent`, ~0.4 KB) that
 * product_analytics needs in the EU, so the enforced limit is 5 KB. The banner itself is `consent.js`
 * (~1.1 KB), loaded only by the sites that ask for it. See docs/CHECKLIST.md ("Size budget") for what
 * would have to go to get back to 3 KB.
 */
export const BUDGET = 5 * 1024;
