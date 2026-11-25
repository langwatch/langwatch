import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  // The evaluator catalog (services/langevals/ts-integration/evaluators.generated.ts)
  // is now Zod-first and imports `zod`, but it lives outside any node_modules
  // tree, so esbuild cannot resolve `zod` relative to it. Fall back to this
  // package's own node_modules (where zod is a declared dependency) so the
  // schemas still bundle into the standalone output.
  nodePaths: ["node_modules"],
  banner: {
    // Inlined CommonJS (express, debug) calls `require()` on Node builtins,
    // and an ES module has none: `--http` died on `Dynamic require of "tty"`.
    // The alias keeps clear of any `createRequire` the bundle declares.
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __langwatchCreateRequire } from "node:module";',
      "const require = __langwatchCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
