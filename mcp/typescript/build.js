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
    // The bundle inlines CommonJS packages (express, body-parser, debug) that
    // `require()` Node builtins at load time. An ES module has no `require`,
    // so esbuild's shim threw `Dynamic require of "tty" is not supported` the
    // moment `--http` loaded express. Giving the module a real `require`
    // lets those calls through. The aliased import keeps it clear of any
    // `createRequire` binding the bundle declares itself.
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __langwatchCreateRequire } from "node:module";',
      "const require = __langwatchCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
