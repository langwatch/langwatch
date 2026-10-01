import { existsSync, realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { processFailureLine } from "@langwatch/observability";
import type * as ApiMain from "@langwatch/platform-api";
import type * as WorkerMain from "@langwatch/worker";
import { createServer, createServerModuleRunner, type ViteDevServer } from "vite";
import type { ModuleRunner } from "vite/module-runner";

import {
  backendHalfOf,
  BACKEND_HALF_SERVICE,
  BACKEND_READY_MSG,
  drainBackend,
  startBackend,
  type BackendHalves,
} from "./backend.process.ts";
import {
  createReloadTrigger,
  holdRemainingMs,
  invalidateModules,
  staleModuleIds,
} from "./backend.reload.ts";

/**
 * Local-only host for the whole Node side of a stack in one process (ADR-168, B1): the UI's Vite
 * server, plus api and worker through a Vite module runner, so a backend edit re-boots them while
 * the HMR socket stays up. Production still runs each app's own main.ts.
 */
const APP_SERVICE = "langwatch-app";
const SHUTDOWN_DEADLINE_MS = 20_000;
const REPO_ROOT = realpathSync(path.resolve(import.meta.dirname, "../../.."));
const UI_ROOT = path.join(REPO_ROOT, "apps/ui");
const API_ENTRY = fileURLToPath(import.meta.resolve("@langwatch/platform-api"));
const WORKER_ENTRY = fileURLToPath(import.meta.resolve("@langwatch/worker"));
/** Where backend source lives; only files the runner actually loaded trigger a reload. */
const WATCH_ROOTS = ["apps/api/src", "apps/worker/src", "packages", "modules", "enterprise"];
const IGNORED_PATH = /(^|\/)(node_modules|dist|\.git|__tests__)(\/|$)/;
const CODE_FILE = /\.[cm]?[jt]sx?$/;

const write = (line: string): void => void process.stderr.write(line);
const envMs = ({ name, fallback }: { name: string; fallback: number }): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const isWatching = !["0", "false", "off"].includes(
  (process.env.LANGWATCH_DEV_WATCH ?? "").trim().toLowerCase(),
);

let ui: ViteDevServer | undefined;
let backendVite: ViteDevServer | undefined;
let runner: ModuleRunner | undefined;
let halves: BackendHalves | undefined;
let generation = 0;
/** The last link or boot failed: the next code change retries, loaded or not. */
let isRetryOwed = false;
let reloading: Promise<void> = Promise.resolve();
let stopping: Promise<void> | undefined;
const watchers: FSWatcher[] = [];

const stop = (code: number): Promise<void> => {
  stopping ??= (async () => {
    const deadline = setTimeout(() => {
      write(
        processFailureLine({
          service: APP_SERVICE,
          event: "shutdown outlived its deadline; exiting",
        }),
      );
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    let exitCode = code;
    try {
      for (const watcher of watchers) watcher.close();
      await reloading;
      if (halves) await drainBackend(halves);
      await runner?.close();
      await Promise.all([ui?.close(), backendVite?.close()]);
    } catch (error) {
      write(processFailureLine({ service: APP_SERVICE, event: "shutdown failed", error }));
      exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
    process.exit(exitCode);
  })();
  return stopping;
};

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void stop(0);
  });
}

/** The boot guard's crash hook: drain the backend, close both Vite servers, exit non-zero. */
export function stopAfterCrash(): void {
  void stop(1);
}

/** The UI's Vite server, from apps/ui/vite.config.ts unchanged; it proxies /api to the api. */
async function startUi(): Promise<ViteDevServer> {
  const before = new Set(process.listeners("SIGTERM"));
  const server = await createServer({
    root: UI_ROOT,
    configFile: path.join(UI_ROOT, "vite.config.ts"),
    configLoader: "runner",
  });
  // Vite's own SIGTERM hook closes only itself and exits, cutting the backend drain short.
  for (const listener of process.listeners("SIGTERM")) {
    if (!before.has(listener)) process.off("SIGTERM", listener);
  }
  await server.listen();
  server.printUrls();
  return server;
}

/** A bare Vite server for the backend graph: no UI plugins or defines, no HMR, no watcher. */
function startBackendVite(): Promise<ViteDevServer> {
  return createServer({
    configFile: false,
    root: path.join(REPO_ROOT, "tools/dev-runtime"),
    appType: "custom",
    clearScreen: false,
    logLevel: "warn",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
}

/**
 * Link the new generation first; only if it links, drain the old one (worker,
 * then api) and boot the new. A failed link keeps the old generation serving,
 * a failed boot waits for the next change. Never rejects.
 */
async function reload(files: string[]): Promise<void> {
  if (stopping || !runner) return;
  const startedAt = Date.now();
  const modules = runner.evaluatedModules;
  const stale = staleModuleIds({ modules, files });
  if (halves && !isRetryOwed && stale.size === 0) return;
  invalidateModules({ modules, ids: stale });
  const known = new Set(modules.idToModuleMap.keys());
  let worker: typeof WorkerMain;
  let api: typeof ApiMain;
  try {
    worker = await runner.import<typeof WorkerMain>(WORKER_ENTRY);
    api = await runner.import<typeof ApiMain>(API_ENTRY);
  } catch (error) {
    // A module that failed to evaluate caches its rejection; reset what this attempt ran.
    const added = [...modules.idToModuleMap.keys()].filter((id) => !known.has(id));
    invalidateModules({ modules, ids: [...stale, ...added] });
    isRetryOwed = true;
    const event = halves
      ? `backend did not link; generation ${generation} keeps serving`
      : "backend did not link; waiting for a change";
    write(processFailureLine({ service: APP_SERVICE, event, error, level: "warn" }));
    return;
  }
  const drainedAt = Date.now();
  if (halves) {
    const old = halves;
    halves = undefined;
    await drainBackend(old).catch((error: unknown) => {
      write(
        processFailureLine({ service: APP_SERVICE, event: "drain failed", error, level: "warn" }),
      );
    });
  }
  const drainMs = Date.now() - drainedAt;
  if (stopping) return;
  try {
    halves = await startBackend({ startWorker: worker.startWorker, startApi: api.startApi });
  } catch (error) {
    isRetryOwed = true;
    const half = backendHalfOf(error);
    write(
      processFailureLine({
        service: half ? BACKEND_HALF_SERVICE[half] : APP_SERVICE,
        event: "boot failed; waiting for a change",
        error,
        level: "warn",
      }),
    );
    return;
  }
  isRetryOwed = false;
  generation += 1;
  const record = {
    level: "info",
    msg: BACKEND_READY_MSG,
    generation,
    changedFiles: files.length,
    files: files.slice(0, 10).map((file) => path.relative(REPO_ROOT, file)),
    drainMs,
    readyMs: Date.now() - startedAt,
    rssMiB: Math.round(process.memoryUsage.rss() / 1_048_576),
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Watches backend source; a file counts once the runner has loaded it (or a retry is owed). */
function watchBackend({ onFile }: { onFile: (file: string) => void }): void {
  for (const root of WATCH_ROOTS.map((dir) => path.join(REPO_ROOT, dir)).filter(existsSync)) {
    try {
      const watcher = watch(root, { recursive: true }, (_event, name) => {
        if (name && !IGNORED_PATH.test(name)) onFile(path.join(root, name));
      });
      watcher.on("error", (error) => {
        write(
          processFailureLine({
            service: APP_SERVICE,
            event: `stopped watching ${root}`,
            error,
            level: "warn",
          }),
        );
      });
      watchers.push(watcher);
    } catch (error) {
      write(
        processFailureLine({
          service: APP_SERVICE,
          event: `not watching ${root}`,
          error,
          level: "warn",
        }),
      );
    }
  }
}

/** Starts the UI, then the first backend generation, then the watch. */
export async function bootApp(): Promise<void> {
  // The HMR gate marker resolves against cwd (apps/ui/vite/havenHmrGate.ts).
  process.chdir(UI_ROOT);
  ui = await startUi();
  backendVite = await startBackendVite();
  const ssr = backendVite.environments.ssr;
  runner = createServerModuleRunner(ssr, { hmr: false });
  const run = (files: string[]): Promise<void> => {
    reloading = reload(files);
    return reloading;
  };
  await run([]);
  if (!isWatching) return;
  const marker =
    process.env.LANGWATCH_DEV_HOLD_MARKER?.trim() || path.join(UI_ROOT, ".haven-hmr-gate");
  const trigger = createReloadTrigger({
    quietMs: envMs({ name: "LANGWATCH_DEV_WATCH_DEBOUNCE_MS", fallback: 2_000 }),
    maxWaitMs: envMs({ name: "LANGWATCH_DEV_WATCH_MAX_WAIT_MS", fallback: 30_000 }),
    holdMs: () => holdRemainingMs({ marker }),
    run,
  });
  watchBackend({
    onFile: (file) => {
      const isLoaded = runner?.evaluatedModules.getModulesByFile(file) !== undefined;
      if (!isLoaded && !(isRetryOwed && CODE_FILE.test(file))) return;
      ssr.moduleGraph.onFileChange(file);
      trigger.note(file);
    },
  });
}
