import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const rootPkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../../package.json"), "utf8")
);

await build({
  entryPoints: [resolve(__dirname, "../src/cli.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: resolve(__dirname, "../dist/cli.cjs"),
  // The `__cli_url` banner constant lets every bundled module resolve
  // `import.meta.url` correctly — esbuild's CJS output otherwise leaves
  // `import.meta.url` as `undefined`, which trips `fileURLToPath(...)`
  // call sites (services/migrate.ts, predeps/aigateway.ts, …). In ESM
  // tests the per-file `import.meta.url` keeps working unchanged.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'const __cli_url = require("node:url").pathToFileURL(__filename).href;',
    ].join("\n"),
  },
  define: {
    __LANGWATCH_VERSION__: JSON.stringify(rootPkg.version),
    "import.meta.url": "__cli_url",
  },
  minify: false,
  sourcemap: false,
  legalComments: "inline",
  logLevel: "info",
});

console.log(`✓ built dist/cli.cjs (v${rootPkg.version})`);
