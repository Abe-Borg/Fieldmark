import { build } from 'esbuild';
await build({ entryPoints: ['electron/main.ts'], bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: 'dist-electron/main.js', external: ['electron'], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
await build({ entryPoints: ['electron/preload.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist-electron/preload.cjs', external: ['electron'] });
