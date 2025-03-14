import { build } from 'esbuild';

await build({
	entryPoints: ['src/index.ts'],
	outfile: 'dist/index.js',
	bundle: true,
	platform: 'node',
	format: 'esm',
	banner: {
		js: '#!/usr/bin/env node'
	},
});
