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
  banner: { js: "#!/usr/bin/env node" },
  define: {
    __LANGWATCH_VERSION__: JSON.stringify(rootPkg.version),
  },
  minify: false,
  sourcemap: false,
  legalComments: "inline",
  logLevel: "info",
});

console.log(`✓ built dist/cli.cjs (v${rootPkg.version})`);
