// @ts-nocheck

/**
 * Bundles chartsLib into a plain-JS IIFE (`bridge/chartsLibSource.ts`,
 * mirrors `shimSource.ts`). Reads `window.React`/`window.Recharts`
 * directly — the sandboxed iframe loads both as CDN UMD globals first.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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

  const source = `/**
 * GENERATED — do not hand-edit. Produced by \`node scripts/build-charts-lib.mjs\`
 * from \`bridge/chartsLib/index.ts\`. Mirrors \`bridge/shimSource.ts\`'s
 * \`buildShimScript()\` shape: a plain-JS string injected into the sandboxed
 * frame's srcdoc (see \`buildSrcdoc.ts\`), immediately after the Recharts UMD
 * script tag and before the author-runtime script. Bundled by esbuild in IIFE
 * format under the global name "LWCharts"; the library reads
 * \`window.React\` / \`window.Recharts\` directly rather than importing them as
 * modules, so this bundle is only the library's own code and it shares the
 * frame's single React/Recharts instance rather than shipping a second copy.
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
