/**
 * Serves the Web Push service worker at `/push-sw.js`, its root scope. A worker script is one
 * classic file, so browser-host's `push-service-worker.entry.ts` is bundled on its own as an
 * IIFE: in dev on request, at build as an asset beside `index.html`.
 */
import { fileURLToPath } from "node:url";

import { build, type Plugin } from "vite";

export const PUSH_SERVICE_WORKER_FILE = "push-sw.js";

const ENTRY = fileURLToPath(
  new URL("../../../packages/browser-host/src/push-service-worker.entry.ts", import.meta.url),
);

/** The worker as one IIFE script. */
export async function bundlePushServiceWorker({ minify }: { minify: boolean }): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    publicDir: false,
    build: {
      write: false,
      minify,
      sourcemap: false,
      emptyOutDir: false,
      lib: {
        entry: ENTRY,
        formats: ["iife"],
        name: "langwatchPushWorker",
        fileName: () => PUSH_SERVICE_WORKER_FILE,
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) {
    if (!("output" in output)) continue;
    const chunk = output.output.find((item) => item.type === "chunk");
    if (chunk && chunk.type === "chunk") return chunk.code;
  }
  throw new Error("The push service worker bundle produced no script");
}

export function pushServiceWorker(): Plugin {
  let devScript: Promise<string> | null = null;
  return {
    name: "langwatch-push-service-worker",
    configureServer(server) {
      server.watcher.add(ENTRY);
      server.watcher.on("change", (file) => {
        if (file.includes("push-service-worker")) devScript = null;
      });
      server.middlewares.use(`/${PUSH_SERVICE_WORKER_FILE}`, async (_request, response, next) => {
        devScript ??= bundlePushServiceWorker({ minify: false });
        let script: string;
        try {
          script = await devScript;
        } catch (error) {
          devScript = null;
          next(error);
          return;
        }
        response.setHeader("Content-Type", "application/javascript");
        response.setHeader("Cache-Control", "no-cache");
        response.end(script);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: PUSH_SERVICE_WORKER_FILE,
        source: await bundlePushServiceWorker({ minify: true }),
      });
    },
  };
}
