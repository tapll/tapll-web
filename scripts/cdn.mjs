// Stages cdn/public for the static-assets Worker (`cdn/wrangler.jsonc`), served at cdn.tapll.com:
//
//   /v<major>/…           — what every snippet loads; the newest release of that major, cached 1 h
//   /v<x.y.z>/…           — one release, immutable, for SRI-pinned installs — forever
//
// A deploy replaces the whole asset set, so every release ever published must be staged every time:
// `cdn/releases/` (committed) is the archive. This build is added to it on its first deploy and is
// compared byte for byte afterwards — a version number never serves two different files. A major path
// never changes its contract: a breaking SDK change ships under the next major.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const FILES = ['u.js', 'u.js.map', 'u.d.ts', 'consent.js'];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const major = `v${version.split('.')[0]}`;
const sri = (file) => `sha384-${createHash('sha384').update(readFileSync(file)).digest('base64')}`;

// 1. This build joins the archive, or must match what the archive already holds for its version.
const release = `cdn/releases/v${version}`;
if (existsSync(release)) {
  for (const file of FILES) {
    if (!existsSync(`dist/${file}`) || file.endsWith('.map')) continue;
    if (!existsSync(`${release}/${file}`) || !readFileSync(`${release}/${file}`).equals(readFileSync(`dist/${file}`)))
      throw new Error(`${release}/${file} is already published with different bytes — bump the version`);
  }
} else {
  mkdirSync(release, { recursive: true });
  for (const file of FILES) if (existsSync(`dist/${file}`)) cpSync(`dist/${file}`, `${release}/${file}`);
  writeFileSync(`${release}/integrity.txt`, `${sri(`${release}/u.js`)}\n`);
}

// 2. Every archived release at its own path, and this one again at the major path.
const out = 'cdn/public';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const releases = readdirSync('cdn/releases').filter((d) => /^v\d+\.\d+\.\d+$/.test(d));
for (const dir of releases) cpSync(`cdn/releases/${dir}`, `${out}/${dir}`, { recursive: true });
cpSync(release, `${out}/${major}`, { recursive: true });
rmSync(`${out}/${major}/integrity.txt`, { force: true });

// Workers static assets honours `_headers`. CORS `*` because the script is public and read by any site;
// `nosniff` + an explicit type so a misconfigured proxy cannot serve it as something else.
writeFileSync(
  `${out}/_headers`,
  [
    '/*\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n  Cross-Origin-Resource-Policy: cross-origin',
    `/${major}/*\n  Cache-Control: public, max-age=3600, stale-while-revalidate=86400`,
    ...releases.map((dir) => `/${dir}/*\n  Cache-Control: public, max-age=31536000, immutable`),
  ].join('\n\n') + '\n',
);
console.log(`staged ${major} → v${version} (${sri(`${release}/u.js`)}); archive: ${releases.join(', ')}`);
