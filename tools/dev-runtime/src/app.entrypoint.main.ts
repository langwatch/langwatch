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
  disposeGeneration,
  drainBackend,
  listenersAddedSince,
  snapshotListeners,
  startBackend,
  type AddedListener,
  type BackendHalves,
  type ListenerSnapshot,
} from "./backend.process.ts";
import {
  createReloadTrigger,
  invalidateModules,
  recycleReason,
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
/** Non-zero, so dev-supervisor's restart-after-ready starts a fresh process (EX_TEMPFAIL). */
const RECYCLE_EXIT_CODE = 75;

const write = (line: string): void => void process.stderr.write(line);
const envPositive = ({ name, fallback }: { name: string; fallback: number }): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
// LANGWATCH_DEV_RELOAD=process hands every reload to the supervisor's whole-process restart.
const isWatching =
  !["0", "false", "off"].includes((process.env.LANGWATCH_DEV_WATCH ?? "").trim().toLowerCase()) &&
  process.env.LANGWATCH_DEV_RELOAD?.trim() !== "process";
// Only the api lane's supervisor (LANGWATCH_DEV_RELOAD=module) restarts a host that exits
// after ready.
const isRecycleArmed = process.env.LANGWATCH_DEV_RELOAD?.trim() === "module";
const recycleLimits = {
  maxGenerations: envPositive({ name: "LANGWATCH_DEV_RECYCLE_GENERATIONS", fallback: 50 }),
  maxRssMiB: envPositive({ name: "LANGWATCH_DEV_RECYCLE_RSS_MIB", fallback: 4_096 }),
};
const rssMiB = (): number => Math.round(process.memoryUsage.rss() / 1_048_576);

let ui: ViteDevServer | undefined;
let backendVite: ViteDevServer | undefined;
let runner: ModuleRunner | undefined;
let halves: BackendHalves | undefined;
/** The process listeners present when the serving generation booted. */
let listenersAtBoot: ListenerSnapshot = new Map();
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

/** Hands over to a fresh process: the supervisor restarts a host exiting non-zero after ready. */
function recycle(reason: string): void {
  const record = { level: "info", msg: "backend recycling", reason, generation, rssMiB: rssMiB() };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  void stop(RECYCLE_EXIT_CODE);
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

/** Why to recycle, not re-link; armed once a generation was ready under a restarting supervisor. */
function boundReached(): string | undefined {
  if (!isRecycleArmed || generation === 0) return undefined;
  return recycleReason({ generation, rssMiB: rssMiB(), limits: recycleLimits });
}

/**
 * Drains the old generation and answers the listeners it took off, or undefined
 * when its drain failed and the host is recycling: its stores may still hold
 * connections, and a fresh process is the only sure close.
 */
async function disposeOld({
  old,
  added,
}: {
  old: BackendHalves;
  added: readonly AddedListener[];
}): Promise<number | undefined> {
  try {
    return await disposeGeneration({ halves: old, emitter: process, added });
  } catch (error) {
    write(
      processFailureLine({ service: APP_SERVICE, event: "drain failed", error, level: "warn" }),
    );
    const reason = recycleReason({
      generation,
      rssMiB: rssMiB(),
      isDrainFailed: true,
      limits: recycleLimits,
    });
    if (!isRecycleArmed || !reason) return 0;
    recycle(reason);
    return undefined;
  }
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
  const bounded = boundReached();
  if (bounded) return recycle(bounded);
  // Taken before the link, so listeners the new modules attach while evaluating stay theirs.
  const added = listenersAddedSince({ emitter: process, before: listenersAtBoot });
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
  let listenersRemoved = 0;
  if (halves) {
    const old = halves;
    halves = undefined;
    const removed = await disposeOld({ old, added });
    if (removed === undefined) return;
    listenersRemoved = removed;
  }
  const drainMs = Date.now() - drainedAt;
  if (stopping) return;
  listenersAtBoot = snapshotListeners(process);
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
    listenersRemoved,
    readyMs: Date.now() - startedAt,
    rssMiB: rssMiB(),
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

/** Starts the UI (not in the api lane), then the first backend generation, then the watch. */
export async function bootApp({ withUi }: { withUi: boolean }): Promise<void> {
  if (withUi) {
    process.chdir(UI_ROOT);
    ui = await startUi();
  }
  backendVite = await startBackendVite();
  const ssr = backendVite.environments.ssr;
  runner = createServerModuleRunner(ssr, { hmr: false });
  const run = (files: string[]): Promise<void> => {
    reloading = reload(files);
    return reloading;
  };
  await run([]);
  if (!isWatching) return;
  const trigger = createReloadTrigger({
    quietMs: envPositive({ name: "LANGWATCH_DEV_WATCH_DEBOUNCE_MS", fallback: 2_000 }),
    maxWaitMs: envPositive({ name: "LANGWATCH_DEV_WATCH_MAX_WAIT_MS", fallback: 30_000 }),
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
