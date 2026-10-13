// @ts-nocheck

/**
 * Bundles chartsLib into a plain-JS IIFE (`chart-frame-charts-lib-source.ts`).
 * Reads `window.React`/`window.Recharts`: the sandboxed frame loads both as UMD globals first.
 * `--print` writes the fresh bundle to stdout instead (the freshness test compares it).
 */

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Use the bundler already installed for the UI’s Vite build.
const uiRequire = createRequire(path.join(ROOT, "apps/ui/package.json"));
const { build } = createRequire(uiRequire.resolve("vite"))("esbuild");
const ENTRY = path.join(
  ROOT,
  "modules/analytics/browser/src/model/dashboard-widget/chartsLib/index.ts",
);
const OUT_FILE = path.join(ROOT, "modules/analytics/contract/src/chart-frame-charts-lib-source.ts");

async function main() {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "LWCharts",
    platform: "browser",
    target: "es2019",
    minify: true,
  });

  const script = result.outputFiles[0].text;
  if (process.argv.includes("--print")) {
    process.stdout.write(script);
    return;
  }

  const source = `/**
 * GENERATED, do not hand-edit. Produced by \`node dev/scripts/build-charts-lib.mjs\`
 * from \`modules/analytics/browser/src/model/dashboard-widget/chartsLib/index.ts\`,
 * bundled by esbuild in IIFE format. Reads \`window.React\`/\`window.Recharts\`.
 */

export function buildChartsLibScript(): string {
  return ${JSON.stringify(script)};
}
`;

  writeFileSync(OUT_FILE, source);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${script.length} bytes bundled)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
