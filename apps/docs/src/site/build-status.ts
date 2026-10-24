import path from "node:path";

import { loadEnv } from "vite";

import { appRoot, cacheRoot, docsRoot, readBuildOptions } from "../paths.ts";
import { buildFingerprint, buildRecords } from "./build-inputs.ts";

/* Exits 0 when --out-dir already holds a complete build of the current sources for --base-path,
   else 3. A caller that stages builds elsewhere (haven) asks this of the live directory first. */
const { outDir, basePath } = readBuildOptions();
const fingerprint = await buildFingerprint({
  appRoot,
  docsRoot,
  outDir,
  options: { basePath, environment: loadEnv("production", appRoot, "VITE_") },
});
const current = await buildRecords({
  cacheDir: path.join(cacheRoot, "docs-site/builds"),
}).isCurrent({ fingerprint, outDir });
console.log(current ? "[docs-site] up to date" : "[docs-site] build needed");
process.exitCode = current ? 0 : 3;
