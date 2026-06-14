import { defineConfig } from 'tsup';

export default defineConfig([
  // Library core: dual ESM + CJS with type declarations.
  {
    entry: {
      index: 'src/index.ts',
      webhook: 'src/webhook.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'node18',
    outExtension({ format }) {
      // package.json is "type": "module", so .js === ESM, .cjs === CommonJS.
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
  },
  // CLI: single ESM executable referenced by `bin.clipia`.
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    clean: false,
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
  },
]);
