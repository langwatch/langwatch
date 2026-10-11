import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "vite";

import { createViteConfig } from "../vite.config.mjs";

const run = promisify(execFile);
const ssrDir = fileURLToPath(new URL("../dist-ssr", import.meta.url));
await rm(ssrDir, { recursive: true, force: true });
try {
  await build({ ...createViteConfig(), configFile: false, logLevel: "warn" });
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
  ]);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await rm(ssrDir, { recursive: true, force: true });
}
