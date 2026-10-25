/**
 * Gzip budget for dist/u.js in bytes. One place, read by `pnpm size` and by test/size.test.ts.
 *
 * The original target was 3 KB (3072). The full 0.1.0 feature set (strict + product_analytics, SPA pageviews,
 * $page_leave with scroll/engagement, outbound/download/tagged clicks, retry + response policy, persisted
 * queue, never-throw API) measures about 4.4 KB, so the enforced limit is 4.5 KB. See docs/CHECKLIST.md
 * ("Size budget") for what would have to go to get back to 3 KB.
 */
export const BUDGET = 4.5 * 1024;
