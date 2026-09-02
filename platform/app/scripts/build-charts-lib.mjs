/**
 * Bundles `src/features/custom-chart-playground/bridge/chartsLib/index.ts`
 * into a plain-JS IIFE string and writes it as the generated
 * `bridge/chartsLibSource.ts`, mirroring how `bridge/shimSource.ts` exports
 * `buildShimScript()`.
 *
 * `chartsLib/index.ts` reads `window.React` / `window.Recharts` directly
 * instead of `import`-ing "react"/"recharts" — the sandboxed frame's srcdoc
 * already loaded both as CDN UMD globals before this script runs (see
 * `buildSrcdoc.ts`) — so there is nothing to mark `external` or alias here:
 * the bundle is just the library's own code, sharing the frame's single
 * React/Recharts instance rather than shipping a second copy.
 *
 * Run manually after editing chartsLib: `node scripts/build-charts-lib.mjs`.
 * The output is a committed file, not built at app-build time — same
 * treatment `shimSource.ts` gets, since both are plain strings injected into
 * an iframe srcdoc rather than app code esbuild would otherwise bundle.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(
  APP,
  "src/features/custom-chart-playground/bridge/chartsLib/index.ts",
);
const OUT_FILE = path.join(
  APP,
  "src/features/custom-chart-playground/bridge/chartsLibSource.ts",
);

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
  console.log(`Wrote ${path.relative(APP, OUT_FILE)} (${script.length} bytes bundled)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
