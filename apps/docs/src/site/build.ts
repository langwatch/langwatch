import { execFile } from "node:child_process";
import { symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { build, loadEnv } from "vite";

import { buildNav } from "../features/navigation/compile.ts";
import { appRoot, cacheRoot, docsRoot, publicRoot, readBuildOptions } from "../paths.ts";
import { assertMaterializedAssets } from "./assets.ts";
import { buildFingerprint, buildRecords } from "./build-inputs.ts";
import { PRERENDER_PLAN_FILE, pageRenderKeys, type PrerenderPlan } from "./render-keys.ts";
import { withTemporaryDirectory } from "./temporary-directory.ts";
import { createViteConfig } from "./vite-config.ts";

/* Client build, then an SSR bundle of prerender.ts that renders every page into the client
   output and versions them by content. The bundle lives in this build's own temporary
   directory; a node_modules link there lets its external imports (react, shiki) resolve. */
const { outDir, basePath, renderWorkers, renderCache } = readBuildOptions();
const run = promisify(execFile);
const renderCacheDir = path.join(cacheRoot, "docs-site/render");
const records = buildRecords({ cacheDir: path.join(cacheRoot, "docs-site/builds") });
const fingerprint = renderCache
  ? await buildFingerprint({
      appRoot,
      docsRoot,
      outDir,
      /* The public VITE_ settings a client build inlines. */
      options: { basePath, environment: loadEnv("production", appRoot, "VITE_") },
    })
  : null;
if (fingerprint && (await records.isCurrent({ fingerprint, outDir }))) {
  console.log(`[docs-site] ${outDir} already holds a build of these sources; nothing to do`);
} else {
  await buildSite();
  if (fingerprint) await records.save({ fingerprint, outDir });
}

async function buildSite() {
  await assertMaterializedAssets({ docsRoot, publicRoot });
  await build({ ...createViteConfig({ outDir, basePath }), configFile: false, logLevel: "warn" });
  await withTemporaryDirectory({
    parent: tmpdir(),
    prefix: "docs-prerender-",
    run: async (ssrDir) => {
      await symlink(path.join(appRoot, "node_modules"), path.join(ssrDir, "node_modules"), "dir");
      const config = createViteConfig({ basePath });
      const bundle = await build({
        ...config,
        configFile: false,
        logLevel: "warn",
        define: { ...config.define, __DOCS_APP_ROOT__: JSON.stringify(appRoot) },
        build: { ssr: "src/site/prerender.ts", outDir: ssrDir, emptyOutDir: false },
      });
      const outputs = Array.isArray(bundle) ? bundle : [bundle];
      const chunks = outputs.flatMap((result) =>
        "output" in result ? result.output.filter((item) => item.type === "chunk") : [],
      );
      const plan: PrerenderPlan = {
        keys: await pageRenderKeys({
          chunks,
          slugs: [...Object.keys(buildNav({ docsRoot }).pages), "404"],
          docsRoot,
          appRoot,
        }),
        cacheDir: renderCache ? renderCacheDir : null,
        workers: renderWorkers,
      };
      const planFile = path.join(ssrDir, PRERENDER_PLAN_FILE);
      await writeFile(planFile, JSON.stringify(plan));
      const { stdout, stderr } = await run(
        process.execPath,
        [
          path.join(ssrDir, "prerender.js"),
          "--out-dir",
          outDir,
          ...(basePath ? ["--base-path", basePath] : []),
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      process.stdout.write(stdout);
      process.stderr.write(stderr);
    },
  });
}
