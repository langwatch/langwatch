import { execFile } from "node:child_process";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { build } from "vite";

import { appRoot, docsRoot, publicRoot, readBuildOptions } from "../paths.ts";
import { assertMaterializedAssets } from "./assets.ts";
import { writeServiceWorker } from "./service-worker.ts";
import { withTemporaryDirectory } from "./temporary-directory.ts";
import { createViteConfig } from "./vite-config.ts";

/* Client build, then an SSR bundle of prerender.ts that renders every page into the client
   output, then the service worker. The bundle lives in this build's own temporary directory;
   a node_modules link there lets its external imports (react, shiki) resolve from this app. */
const { outDir } = readBuildOptions();
const run = promisify(execFile);

await assertMaterializedAssets({ docsRoot, publicRoot });
await build({ ...createViteConfig({ outDir }), configFile: false, logLevel: "warn" });
await withTemporaryDirectory({
  parent: tmpdir(),
  prefix: "docs-prerender-",
  run: async (ssrDir) => {
    await symlink(path.join(appRoot, "node_modules"), path.join(ssrDir, "node_modules"), "dir");
    await build({
      ...createViteConfig(),
      configFile: false,
      logLevel: "warn",
      define: { __DOCS_APP_ROOT__: JSON.stringify(appRoot) },
      build: { ssr: "src/site/prerender.ts", outDir: ssrDir, emptyOutDir: false },
    });
    const { stdout, stderr } = await run(process.execPath, [
      path.join(ssrDir, "prerender.js"),
      "--out-dir",
      outDir,
    ]);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  },
});
await writeServiceWorker({ outDir });
