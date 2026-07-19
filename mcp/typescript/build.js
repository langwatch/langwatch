import { build } from 'esbuild';

await build({
	entryPoints: ['src/index.ts'],
	outfile: 'dist/index.js',
	bundle: true,
	platform: 'node',
	format: 'esm',
	// The evaluator catalog (langevals/ts-integration/evaluators.generated.ts)
	// is now Zod-first and imports `zod`, but it lives outside any node_modules
	// tree, so esbuild cannot resolve `zod` relative to it. Fall back to this
	// package's own node_modules (where zod is a declared dependency) so the
	// schemas still bundle into the standalone output.
	nodePaths: ['node_modules'],
	banner: {
		js: '#!/usr/bin/env node'
	},
});
