import { existsSync, realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { processFailureLine } from "@langwatch/observability";
import type * as ApiMain from "@langwatch/platform-api";
import {
  backendHalfOf,
  BACKEND_HALF_SERVICE,
  BACKEND_READY_MSG,
  drainBackend,
  type BackendHalves,
} from "@langwatch/process/backend-host";
import type * as WorkerMain from "@langwatch/worker";
import {
  createRunnableDevEnvironment,
  createServer,
  createServerModuleRunner,
  type DevEnvironment,
  type ViteDevServer,
} from "vite";
import { ESModulesEvaluator, type ModuleEvaluator, type ModuleRunner } from "vite/module-runner";

import {
  disposeGeneration,
  freeLoopbackPort,
  listenersAddedSince,
  replaceBackend,
  snapshotListeners,
  startFreshBackend,
  type AddedListener,
  type ListenerSnapshot,
  type PortForwarder,
} from "./backend.process.ts";
import {
  createReloadTrigger,
  createRetrySchedule,
  invalidateModules,
  recycleReason,
  staleModuleIds,
} from "./backend.reload.ts";
import { bootFailureOf, type BootFailure } from "./boot-failure.ts";
import { buildOrb, forwardPortWithOrb, servesOrb, type OrbBuild } from "./haven-orb.ts";

/**
 * Local-only host for api and worker in one process (ADR-168), loaded through a Vite module
 * runner so a backend edit re-links them in place. The UI is served built, or by its own Vite
 * lane under --hmr (amendment 2026-10-10). Production still runs each app's own main.ts.
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
/** Non-zero, so the dev script's loop or haven's lane starts a fresh process (EX_TEMPFAIL). */
const RECYCLE_EXIT_CODE = 75;

const write = (line: string): void => void process.stderr.write(line);
const envPositive = ({ name, fallback }: { name: string; fallback: number }): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
// LANGWATCH_DEV_WATCH=0 holds the backend: no reload on a file change, only on `haven reload`.
// The UI's Vite HMR is unaffected.
const isWatching = !["0", "false", "off"].includes(
  (process.env.LANGWATCH_DEV_WATCH ?? "").trim().toLowerCase(),
);
// A recycled host exits 75 after ready; the dev script's loop (or haven's lane) starts a fresh one.
const recycleLimits = {
  maxGenerations: envPositive({ name: "LANGWATCH_DEV_RECYCLE_GENERATIONS", fallback: 50 }),
  maxRssMiB: envPositive({ name: "LANGWATCH_DEV_RECYCLE_RSS_MIB", fallback: 8_192 }),
};
const rssMiB = (): number => Math.round(process.memoryUsage.rss() / 1_048_576);

let backendVite: ViteDevServer | undefined;
let runner: ModuleRunner | undefined;
let halves: BackendHalves | undefined;
/** API_PORT, held by the host so a reload never closes it; each generation binds its own port. */
let apiPort: PortForwarder | undefined;
/** The process listeners present when the serving generation booted. */
let listenersAtBoot: ListenerSnapshot = new Map();
let generation = 0;
/** The last link or boot failed: the next code change retries, loaded or not. */
let isRetryOwed = false;
let reloading: Promise<void> = Promise.resolve();
let stopping: Promise<void> | undefined;
const watchers: FSWatcher[] = [];
/** Files changed while the stack is held, applied by the next on-demand reload. */
const held = new Set<string>();
/** A failed boot or link retries on its own as well as on a change (Alex, 2026-10-10). */
const retries = createRetrySchedule({
  retry: () => {
    reloading = reloading.then(() => reload([]));
  },
});

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
      retries.reset();
      await timedStep("pending reload", () => reloading);
      const draining = halves;
      if (draining) await timedStep("backend drain", () => drainBackend(draining));
      await timedStep("api port", () => apiPort?.close());
      await timedStep("module runner", () => runner?.close());
      await timedStep("backend vite", () => backendVite?.close());
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

/** A shutdown that outlives its deadline names the step it was stuck in, not just the deadline. */
async function timedStep(step: string, run: () => Promise<unknown> | undefined): Promise<void> {
  const startedAt = Date.now();
  await run();
  const record = { level: "info", msg: "shutdown step done", step, ms: Date.now() - startedAt };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Hands over to a fresh process: the dev script's loop restarts a host exiting 75. */
function recycle(reason: string): void {
  const record = { level: "info", msg: "backend recycling", reason, generation, rssMiB: rssMiB() };
  process.stdout.write(`${JSON.stringify(record)}\n`);
  void stop(RECYCLE_EXIT_CODE);
}

/** The boot guard's crash hook: drain the backend, close the Vite server, exit non-zero. */
export function stopAfterCrash(): void {
  void stop(1);
}

/**
 * A bare Vite server for the backend graph: no UI plugins or defines, no HMR, no watcher.
 * No inline source maps: base64 maps in every module's code doubled the heap (1107 -> 507 MB).
 */
function startBackendVite(): Promise<ViteDevServer> {
  return createServer({
    configFile: false,
    root: path.join(REPO_ROOT, "tools/dev-runtime"),
    appType: "custom",
    clearScreen: false,
    logLevel: "warn",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    environments: {
      ssr: {
        dev: {
          createEnvironment: (name, config) =>
            createRunnableDevEnvironment(name, config, {
              remoteRunner: { inlineSourceMap: false },
            }),
        },
      },
    },
  });
}

/** Ends each evaluation's sourceURL with `?lw=<n>`: the runner caches a map per URL forever. */
const EVALUATION_TAG = /\?lw=\d+$/;
let evaluations = 0;

function taggedEvaluator(): ModuleEvaluator {
  const base = new ESModulesEvaluator();
  return {
    startOffset: base.startOffset,
    runExternalModule: (file) => base.runExternalModule(file),
    runInlinedModule: (context, code, mod) => {
      evaluations += 1;
      return base.runInlinedModule(context, `${code}\n//# sourceURL=${mod.id}?lw=${evaluations}`);
    },
  };
}

/** Stack traces map through the maps Vite's module graph already holds, not inline copies. */
function createBackendRunner(ssr: DevEnvironment): ModuleRunner {
  const evaluator = taggedEvaluator();
  const padding = ";".repeat(evaluator.startOffset ?? 0);
  return createServerModuleRunner(ssr, {
    hmr: false,
    evaluator,
    sourcemapInterceptor: {
      retrieveSourceMap: (url) => {
        const id = url.replace(EVALUATION_TAG, "");
        const map = ssr.moduleGraph.getModuleById(id)?.transformResult?.map;
        if (!map || !("version" in map)) return null;
        return { url: id, map: { ...map, mappings: padding + map.mappings } };
      },
    },
  });
}

/** Why to recycle, not re-link; armed once a generation was ready. */
function boundReached(): string | undefined {
  if (generation === 0) return undefined;
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
    if (!reason) return 0;
    recycle(reason);
    return undefined;
  }
}

/** Logs a failure by the half it came from, shows it on the api's port, and arms the retry. */
function reportFailure({
  half,
  event,
  error,
  level,
}: {
  half: BootFailure["half"];
  event: string;
  error: unknown;
  level: "fatal" | "warn";
}): void {
  isRetryOwed = true;
  const delay = retries.failed();
  apiPort?.report(bootFailureOf({ half, error, retryAt: Date.now() + delay }));
  const service = half === "backend" ? APP_SERVICE : BACKEND_HALF_SERVICE[half];
  const retry = `retrying in ${delay / 1000}s or on a change`;
  write(processFailureLine({ service, event: `${event}; ${retry}`, error, level }));
}

/** A boot that threw: fatal, named by the half that refused it; the api serves if it can. */
function bootRefused(error: unknown): void {
  const half = backendHalfOf(error) ?? "backend";
  let event = `${half} failed to boot; no api is serving`;
  if (half === "worker")
    event = "worker failed to boot; the api keeps serving but jobs are not running";
  else if (halves) event = `${half} failed to boot; generation ${generation} keeps serving`;
  reportFailure({ half, event, error, level: "fatal" });
}

/**
 * Boots the linked generation: beside the serving one (api, API_PORT moves, old drains, worker),
 * else both halves fresh, API_PORT routed once the api starts. Answers how many listeners the old
 * generation left behind; a refused half throws, tagged with its name.
 */
async function bootNext({
  worker,
  api,
  added,
}: {
  worker: typeof WorkerMain;
  api: typeof ApiMain;
  added: readonly AddedListener[];
}): Promise<number> {
  const port = await freeLoopbackPort();
  const old = halves;
  if (!old) {
    const started = await startFreshBackend({
      startWorker: worker.startWorker,
      startApi: api.startApi,
      apiPort: port,
      route: (next) => apiPort?.route(next),
    });
    halves = started.halves;
    if (started.workerFailure !== undefined) throw started.workerFailure;
    return 0;
  }
  let removed = 0;
  const replaced = await replaceBackend({
    startWorker: worker.startWorker,
    startApi: api.startApi,
    apiPort: port,
    route: (next) => apiPort?.route(next),
    disposeOld: async () => {
      halves = undefined;
      const count = await disposeOld({ old, added });
      // Recycling: the old generation did not drain, so no worker starts beside it.
      if (count === undefined) throw new Error("recycling after a failed drain");
      removed = count;
    },
  });
  halves = replaced.halves;
  if (replaced.workerFailure !== undefined) throw replaced.workerFailure;
  return removed;
}

/**
 * Link the new generation first; only if it links, boot its api beside the old one, move
 * API_PORT to it, drain the old (worker, then api) and start the new worker. A failed link or
 * api boot keeps the old generation serving. Never rejects.
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
    const event = halves
      ? `backend did not link; generation ${generation} keeps serving`
      : "backend did not link; no api is serving";
    reportFailure({ half: "backend", event, error, level: "warn" });
    return;
  }
  const drainedAt = Date.now();
  let listenersRemoved: number;
  if (stopping) return;
  listenersAtBoot = snapshotListeners(process);
  try {
    listenersRemoved = await bootNext({ worker, api, added });
  } catch (error) {
    if (!stopping) bootRefused(error);
    return;
  }
  const swapMs = Date.now() - drainedAt;
  isRetryOwed = false;
  retries.reset();
  apiPort?.report(undefined);
  generation += 1;
  const record = {
    level: "info",
    msg: BACKEND_READY_MSG,
    generation,
    changedFiles: files.length,
    files: files.slice(0, 10).map((file) => path.relative(REPO_ROOT, file)),
    swapMs,
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

let orb: Promise<OrbBuild | undefined> | undefined;

/** The orb's build, once per process and on first use; a failed build leaves pages orb-less. */
function loadOrb(): Promise<OrbBuild | undefined> {
  orb ??= buildOrb({ uiRoot: UI_ROOT }).catch((error: unknown) => {
    write(
      processFailureLine({ service: APP_SERVICE, event: "orb build failed", error, level: "warn" }),
    );
    return undefined;
  });
  return orb;
}

/** Holds API_PORT, starts the watch, then boots the first backend generation. */
export async function bootApp(): Promise<void> {
  const port = envPositive({ name: "API_PORT", fallback: 6_560 });
  const withOrb = servesOrb({ slug: process.env.LANGWATCH_SLUG });
  apiPort = await forwardPortWithOrb({
    port,
    orb: withOrb ? loadOrb : undefined,
    isUiWatch: withOrb && process.env.LANGWATCH_UI_WATCH === "1",
  });
  backendVite = await startBackendVite();
  const ssr = backendVite.environments.ssr;
  runner = createBackendRunner(ssr);
  const trigger = createReloadTrigger({
    quietMs: envPositive({ name: "LANGWATCH_DEV_WATCH_DEBOUNCE_MS", fallback: 2_000 }),
    maxWaitMs: envPositive({ name: "LANGWATCH_DEV_WATCH_MAX_WAIT_MS", fallback: 30_000 }),
    run: (files) => {
      reloading = reloading.then(() => reload(files));
      return reloading;
    },
  });
  // Watched before the first boot, so an edit landing while it runs queues one follow-up.
  // Held (LANGWATCH_DEV_WATCH=0): edits wait in `held` until `haven reload` sends SIGUSR2.
  watchBackend({
    onFile: (file) => {
      const isLoaded = runner?.evaluatedModules.getModulesByFile(file) !== undefined;
      if (!isLoaded && !(isRetryOwed && CODE_FILE.test(file))) return;
      ssr.moduleGraph.onFileChange(file);
      if (!isWatching) return void held.add(file);
      retries.reset();
      trigger.note(file);
    },
  });
  process.on("SIGUSR2", () => {
    const files = [...held];
    held.clear();
    reloading = reloading.then(async () => {
      await reload(files);
      process.stdout.write(
        `${JSON.stringify({ level: "info", msg: "backend reload finished", generation, changedFiles: files.length })}\n`,
      );
    });
  });
  await trigger.boot();
}
