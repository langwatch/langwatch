import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "vite";

import { writeCloudFrontFunction } from "../cloudfront/generate.mjs";
import { createViteConfig } from "../vite.config.mjs";
import { readBuildOptions } from "./options.mjs";

const { outDir } = readBuildOptions();
const run = promisify(execFile);
const ssrDir = fileURLToPath(new URL("../dist-ssr", import.meta.url));
await rm(ssrDir, { recursive: true, force: true });
try {
  await build({ ...createViteConfig({ outDir }), configFile: false, logLevel: "warn" });
  await build({
    ...createViteConfig(),
    configFile: false,
    logLevel: "warn",
    build: {
      ssr: "scripts/prerender.mjs",
      outDir: ssrDir,
      emptyOutDir: true,
      rollupOptions: { external: (id) => id.endsWith("docs-highlight.mjs") },
    },
  });
  const { stdout, stderr } = await run(process.execPath, [
    fileURLToPath(new URL("../dist-ssr/prerender.js", import.meta.url)),
    "--out-dir",
    outDir,
  ]);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  await writeCloudFrontFunction({
    docsRoot: fileURLToPath(new URL("../..", import.meta.url)),
    outDir,
  });
} finally {
  await rm(ssrDir, { recursive: true, force: true });
}
