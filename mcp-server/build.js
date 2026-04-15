import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
	entryPoints: ['src/index.ts'],
	outfile: 'dist/index.js',
	bundle: true,
	platform: 'node',
	format: 'esm',
	banner: {
		js: '#!/usr/bin/env node'
	},
	nodePaths: [resolve(__dirname, 'node_modules')],
});
