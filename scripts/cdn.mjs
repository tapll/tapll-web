// Stages dist/ into cdn/public for the static-assets Worker (`cdn/wrangler.jsonc`), served at
// cdn.useunion.dev:
//
//   /v<major>/u.js        — what every snippet loads; replaced on each release, cached 1 h
//   /v<x.y.z>/u.js        — this exact release, immutable, for SRI-pinned installs
//
// A major path never changes its contract: a breaking SDK change ships under the next major, so a
// site that copied the snippet a year ago keeps working. Also writes `integrity.txt` with the SRI
// hash of the exact build, for the README.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const major = `v${version.split('.')[0]}`;
const out = 'cdn/public';

rmSync(out, { recursive: true, force: true });
for (const dir of [major, `v${version}`]) {
  mkdirSync(`${out}/${dir}`, { recursive: true });
  for (const file of ['u.js', 'u.js.map', 'u.d.ts', 'consent.js']) copyFileSync(`dist/${file}`, `${out}/${dir}/${file}`);
}

const integrity = `sha384-${createHash('sha384').update(readFileSync('dist/u.js')).digest('base64')}`;
writeFileSync(`${out}/v${version}/integrity.txt`, `${integrity}\n`);

// Workers static assets honours `_headers`. CORS `*` because the script is public and read by any site;
// `nosniff` + an explicit type so a misconfigured proxy cannot serve it as something else.
writeFileSync(
  `${out}/_headers`,
  `/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
  Cross-Origin-Resource-Policy: cross-origin

/${major}/*
  Cache-Control: public, max-age=3600, stale-while-revalidate=86400

/v${version}/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log(`staged ${major} and v${version} (${integrity})`);
