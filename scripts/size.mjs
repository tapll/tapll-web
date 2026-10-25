import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { BUDGET } from './budget.mjs';

const size = gzipSync(readFileSync('dist/u.js'), { level: 9 }).length;
console.log(`dist/u.js: ${size} B gzip (budget ${BUDGET} B)`);
if (size > BUDGET) {
  console.error('size budget exceeded');
  process.exit(1);
}
