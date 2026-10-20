// julia's lane: orchestrator that implements RuntimeApi.
// Wired up by the CLI through its static import of `runtime`.

import type { PredepId } from "../predeps/types.ts";
import { ownDatabases, type DatabaseId } from "../shared/databases.ts";
import { scaffoldEnvFile } from "../shared/env.ts";
import { featureEnv, resolveEffectiveFeatures } from "../shared/features.ts";
import type {
  RuntimeApi,
  RuntimeContext,
  RuntimeEvent,
  ServiceHandle,
} from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import { startClickhouse } from "./clickhouse.ts";
import { readEnvFile } from "./env-file.ts";
import { EventBus } from "./event-bus.ts";
import { startGoServices } from "./go-services.ts";
import { startLangevals } from "./langevals.ts";
import { startLangwatch } from "./langwatch.ts";
import { ensureLangyCli } from "./langy-cli.ts";
import { monobinarySupportsLangyagent, startLangyagent } from "./langyagent.ts";
import { ensureTiktokenEncodings } from "./offline-defaults.ts";
import { startPostgres } from "./postgres.ts";
import { startRedis } from "./redis.ts";
import { stopEverySupervised, type SupervisedHandle } from "./spawn.ts";
import { syncVenvs } from "./venvs.ts";

// One bus per RuntimeContext. The CLI calls events(ctx) before startAll
// (via the [3/4] services phase) and the same bus is used throughout.
const buses = new WeakMap<RuntimeContext, EventBus>();

function busFor(ctx: RuntimeContext): EventBus {
  let bus = buses.get(ctx);
  if (!bus) {
    bus = new EventBus();
    buses.set(ctx, bus);
  }
  return bus;
}

/** Starts a step and records its handles, unless the boot was abandoned meanwhile. */
type Keep = (start: () => Promise<SupervisedHandle[]>) => Promise<SupervisedHandle[]>;

const runtimeImpl: RuntimeApi = {
  // Idempotent .env scaffolder. reconcilePorts defaults to true (start flow).
  async scaffoldEnv(ctx, { shouldReconcilePorts = true } = {}) {
    return scaffoldEnvFile({
      ports: ctx.ports,
      path: ctx.envFile,
      shouldReconcilePorts,
    });
  },

  async installServices(ctx) {
    const bus = busFor(ctx);
    // The app tree is already in place: the `app` predep installed the prebuilt app, or this is a
    // checkout its developer installed and built (ADR-180). What is left is per machine: the uv
    // environment and the tokenizer cache, each idempotent and in parallel.
    const features = resolveEffectiveFeatures(ctx.envFile);
    await Promise.all([
      syncVenvs(ctx, bus),
      ensureTiktokenEncodings({ paths: ctx.paths, bus, appRootDir: appRoot() }),
      // The assistant's CLI: only an install running it needs the download.
      ...(features.isLangyEnabled ? [ensureLangyCli(ctx, bus)] : []),
    ]);
  },

  async startAll(ctx) {
    const bus = busFor(ctx);
    const envFromFile = readEnvFile(ctx.envFile);
    const userEnv = { ...envFromFile, ...ctx.userEnv };
    // A database the person brings is theirs to run: never downloaded, started or stopped here.
    const own = ownDatabases({ env: envFromFile, ports: ctx.ports });
    const features = resolveEffectiveFeatures(ctx.envFile);
    const predepsReady = ctx.predepsReady ?? (async () => undefined);
    const predepsPresent =
      ctx.predepsPresent ?? ((ids: readonly PredepId[]) => predepsReady(ids).then(() => true));
    const handles: SupervisedHandle[] = [];
    let isAbandoned = false;
    // Records what a step started; a step that finishes after another failed stops what it made.
    const keep: Keep = async (start) => {
      if (isAbandoned) throw new Error("boot abandoned after another service failed");
      const started = await start();
      if (isAbandoned) {
        await stopHandles(started);
        throw new Error("boot abandoned after another service failed");
      }
      handles.push(...started);
      return started;
    };
    const bundled = (id: DatabaseId, start: () => Promise<SupervisedHandle>) =>
      own.includes(id)
        ? Promise.resolve([])
        : predepsReady([id]).then(() => keep(async () => [await start()]));
    // The app tier's env: the user's keys win over the blank .env lines, and the feature
    // toggles ride along (featureEnv) so the app describes exactly this install.
    const envFor = (isLangyEnabled: boolean): Record<string, string> => {
      const env = { ...userEnv, ...featureEnv({ ...features, isLangyEnabled }) };
      if (!isLangyEnabled) hideLangyFrom(env);
      return env;
    };

    // Each service starts once what it needs is in place (spec 09, "Starting"): the stores on
    // their own binaries, while the app is still arriving; nothing waits on LangEvals.
    const infra = Promise.all([
      bundled("postgres", () => startPostgres(ctx, bus)),
      bundled("redis", () => startRedis(ctx, bus)),
      bundled("clickhouse", () => startClickhouse(ctx, bus)),
    ]);
    const isLangyRunnable = predepsReady(["aigateway"]).then(() =>
      langyRunnable({ ctx, bus, isLangyEnabled: features.isLangyEnabled }),
    );
    const go = Promise.all([infra, isLangyRunnable]).then(([, runnable]) =>
      keep(() => startGoServices(ctx, bus, envFor(runnable))),
    );
    // The assistant boots before the backend, so the app is told whether it is really there.
    const isLangyUp = Promise.all([
      infra,
      isLangyRunnable,
      predepsReady(["pnpm"]),
      predepsPresent(["opencode"]),
    ]).then(async ([, runnable, , hasOpencode]) => {
      if (!runnable) return false;
      if (!hasOpencode) {
        notice({ bus, service: "langyagent", line: SKIPPED_LINE.langy });
        return false;
      }
      await ensureLangyCli(ctx, bus);
      return startLangy({ ctx, bus, env: userEnv, keep });
    });
    const backend = Promise.all([infra, predepsReady(["app"]), isLangyUp]).then(([, , langyUp]) =>
      keep(async () => [await startLangwatch(ctx, bus, envFor(langyUp))]),
    );
    // LangEvals reads none of the assistant's settings, so it does not wait on that decision.
    const langevals = Promise.all([predepsReady(["app"]), predepsPresent(["uv"])]).then(
      async ([, hasUv]) => {
        if (!hasUv) {
          notice({ bus, service: "langevals", line: SKIPPED_LINE.langevals });
          return [];
        }
        await syncVenvs(ctx, bus);
        return keep(async () => [await startLangevals(ctx, bus, envFor(features.isLangyEnabled))]);
      },
    );
    // A checkout fills its tokenizer cache here (the prebuilt app ships it); nothing waits on it.
    const tokenizers = predepsReady(["app"]).then(() =>
      ensureTiktokenEncodings({ paths: ctx.paths, bus, appRootDir: appRoot() }),
    );

    try {
      await Promise.all([infra, go, isLangyUp, backend, langevals, tokenizers]);
    } catch (error) {
      isAbandoned = true;
      await stopHandles(handles);
      throw error;
    }
    return handles.map(toServiceHandle);
  },

  async waitForHealth() {
    // startAll already gates on every individual health probe. Keep this
    // as a no-op cross-check so the CLI's [4/4] phase has somewhere to land.
  },

  async stopAll(handles) {
    await stopHandles(handles);
    // A stop during boot: services still waiting on their first health check have no handle yet.
    await stopEverySupervised();
  },

  events(ctx) {
    return busFor(ctx);
  },
};

async function stopHandles(handles: { stop(): Promise<void> }[]): Promise<void> {
  // Reverse start order so app services drain before infra goes down.
  for (const h of [...handles].reverse()) {
    try {
      await h.stop();
    } catch {
      // Swallow — we still want to stop the rest.
    }
  }
}

/** What the terminal says when a predep the person skipped leaves a service off. */
const SKIPPED_LINE = {
  langy:
    "langy assistant disabled: its runtime was skipped after its install failed. Everything else continues without it.",
  langevals:
    "langevals not started: uv was skipped after its install failed. Evaluators that need it stay unavailable; everything else continues.",
};

function notice({ bus, service, line }: { bus: EventBus; service: string; line: string }): void {
  bus.emit({ type: "log", service, stream: "stderr", isNotice: true, line });
}

/** Whether the assistant can run: it is enabled and the installed ai-gateway binary carries it. */
async function langyRunnable({
  ctx,
  bus,
  isLangyEnabled,
}: {
  ctx: RuntimeContext;
  bus: EventBus;
  isLangyEnabled: boolean;
}): Promise<boolean> {
  if (!isLangyEnabled) return false;
  const binary = ctx.predeps.aigateway?.resolvedPath;
  if (binary && (await monobinarySupportsLangyagent(binary))) return true;
  bus.emit({
    type: "log",
    service: "langyagent",
    stream: "stderr",
    isNotice: true,
    line: "langy assistant disabled: the installed ai-gateway binary predates it. The next release's binary includes it and will be picked up automatically.",
  });
  return false;
}

/** Starts the assistant; a failure is logged and leaves it off, and the rest boots without it. */
async function startLangy({
  ctx,
  bus,
  env,
  keep,
}: {
  ctx: RuntimeContext;
  bus: EventBus;
  env: Record<string, string>;
  keep: Keep;
}): Promise<boolean> {
  try {
    await keep(async () => [await startLangyagent(ctx, bus, env)]);
    return true;
  } catch (err) {
    bus.emit({
      type: "log",
      service: "langyagent",
      stream: "stderr",
      isNotice: true,
      line: `langy assistant disabled: it failed to start (${err instanceof Error ? err.message : String(err)}). Everything else continues without it.`,
    });
    return false;
  }
}

/**
 * With the assistant off, the app must not think it exists: an agent URL with no agent behind it
 * hangs every send, and the forced rollout flag would render the panel. The .env keeps its lines
 * (they are the user's knobs); only the running processes lose them.
 */
function hideLangyFrom(childEnv: Record<string, string>): void {
  delete childEnv.LANGY_AGENT_URL;
  const forced = (childEnv.FEATURE_FLAG_FORCE_ENABLE ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f && f !== "release_langy_enabled");
  if (forced.length > 0) childEnv.FEATURE_FLAG_FORCE_ENABLE = forced.join(",");
  else delete childEnv.FEATURE_FLAG_FORCE_ENABLE;
}

function toServiceHandle(h: SupervisedHandle): ServiceHandle {
  return { name: h.name, pid: h.pid, stop: h.stop.bind(h) };
}

export const runtime = runtimeImpl;
export type { RuntimeApi, RuntimeContext, RuntimeEvent, ServiceHandle };
