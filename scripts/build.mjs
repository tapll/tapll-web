// esbuild bundles the TypeScript to an ES2017 IIFE, terser squeezes it (the size budget is tight).
import { build } from 'esbuild';
import { minify } from 'terser';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
const out = await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/u.js',
  bundle: true,
  format: 'iife',
  target: 'es2017',
  minifySyntax: true,
  sourcemap: 'external',
  legalComments: 'none',
  write: false,
  logLevel: 'info',
});
const code = out.outputFiles.find((f) => f.path.endsWith('.js')).text;
const map = out.outputFiles.find((f) => f.path.endsWith('.map')).text;
const res = await minify(code, {
  ecma: 2017,
  compress: { passes: 3, unsafe: true, pure_getters: true },
  mangle: { toplevel: true },
  format: { comments: false },
  sourceMap: { content: map, url: 'u.js.map' },
});
writeFileSync('dist/u.js', res.code);
writeFileSync('dist/u.js.map', res.map);
copyFileSync('src/u.d.ts', 'dist/u.d.ts');
