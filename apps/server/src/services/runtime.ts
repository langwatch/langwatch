// julia's lane: orchestrator that implements RuntimeApi.
// Wired up by the CLI via dynamic import — see shared/runtime-placeholder.ts.

import { featureEnv, resolveEffectiveFeatures } from "../shared/features.ts";
import type {
  RuntimeApi,
  RuntimeContext,
  RuntimeEvent,
  ServiceHandle,
} from "../shared/runtime-contract.ts";
import { startAigateway } from "./aigateway.ts";
import { ensureAppDir } from "./app-dir.ts";
import { startClickhouse } from "./clickhouse.ts";
import { scaffoldEnv } from "./env.ts";
import { readEnvFile } from "./env-file.ts";
import { EventBus } from "./event-bus.ts";
import { startLangevals } from "./langevals.ts";
import { startLangwatch } from "./langwatch.ts";
import { startLangwatchWorkers } from "./langwatch-workers.ts";
import { ensureLangyCli } from "./langy-cli.ts";
import { monobinarySupportsLangyagent, startLangyagent } from "./langyagent.ts";
import { runMigrations } from "./migrate.ts";
import { startNlpgo } from "./nlpgo.ts";
import { ensureLangwatchDeps } from "./node-deps.ts";
import { startPostgres } from "./postgres.ts";
import { startRedis } from "./redis.ts";
import type { SupervisedHandle } from "./spawn.ts";
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

const runtimeImpl: RuntimeApi = {
  async scaffoldEnv(ctx, opts) {
    return scaffoldEnv(ctx, opts);
  },

  async installServices(ctx) {
    const bus = busFor(ctx);
    // Relocate the @langwatch/server tree out of node_modules first —
    // every downstream step (uv sync, pnpm install, migrations, app boot)
    // resolves files via app-dir.ts#appRoot() and needs the relocation
    // to have completed. See app-dir.ts for the tsx/node_modules guard
    // root cause.
    await ensureAppDir(ctx, bus);

    // uv sync + langwatch node_modules + prepare:files run in parallel.
    // Each helper is idempotent and prints "already cached" + early-returns
    // when its lockfile hash matches the previous run.
    const features = resolveEffectiveFeatures(ctx.envFile);
    await Promise.all([
      syncVenvs(ctx, bus),
      ensureLangwatchDeps(ctx, bus),
      // The assistant's CLI: only an install running it needs the download.
      ...(features.isLangyEnabled ? [ensureLangyCli(ctx, bus)] : []),
    ]);
  },

  async startAll(ctx) {
    const bus = busFor(ctx);
    const envFromFile = readEnvFile(ctx.envFile);
    const handles: SupervisedHandle[] = [];

    // Phase 1: infrastructure (postgres, redis, clickhouse) in parallel.
    // Each helper waits for its own health probe so by the time Promise.all
    // resolves every infra service is reachable.
    const [pg, redis, ch] = await Promise.all([
      startPostgres(ctx, bus),
      startRedis(ctx, bus),
      startClickhouse(ctx, bus),
    ]);
    handles.push(pg, redis, ch);

    // Phase 2: migrations (Prisma + ClickHouse goose). Both shell out to
    // the langwatch app's existing pnpm scripts so we stay in lockstep with
    // helm/docker.
    try {
      await runMigrations(ctx, bus, envFromFile);
    } catch (err) {
      await stopHandles(handles);
      throw err;
    }

    // Phase 3: app-tier services in parallel. The langwatch app receives
    // userEnv overlay so the user's provider keys (OPENAI_API_KEY etc.)
    // win over the blank .env entries written by scaffoldEnvFile. The
    // resolved feature toggles ride along explicitly (see featureEnv) so the
    // app describes exactly the install this process just built.
    const features = resolveEffectiveFeatures(ctx.envFile);
    // The assistant is OPTIONAL: nothing else depends on it, so no failure of
    // its own may take the install down. It boots (or declines to) BEFORE the
    // app tier, because the app must be told the truth about it: an agent URL
    // with no agent behind it turns every send into a hang. Two ways it
    // declines, each with its own notice:
    //   - the mono-binary predates the langyagent service (the npm package
    //     and the release binary move in lockstep, but a smoke run of an
    //     unreleased CLI, or an install mid release-window, gets the previous
    //     release's binary, which answers "unknown service");
    //   - it started but never reached healthy.
    let isLangyRunnable = features.isLangyEnabled;
    let langyHandle: SupervisedHandle | null = null;
    if (isLangyRunnable) {
      const binary = ctx.predeps.aigateway?.resolvedPath;
      isLangyRunnable = !!binary && (await monobinarySupportsLangyagent(binary));
      if (!isLangyRunnable) {
        bus.emit({
          type: "log",
          service: "langyagent",
          stream: "stderr",
          line: "langy assistant disabled: the installed ai-gateway binary predates it. The next release's binary includes it and will be picked up automatically.",
        });
      }
    }
    if (isLangyRunnable) {
      try {
        langyHandle = await startLangyagent(ctx, bus, {
          ...envFromFile,
          ...ctx.userEnv,
        });
        handles.push(langyHandle);
      } catch (err) {
        isLangyRunnable = false;
        bus.emit({
          type: "log",
          service: "langyagent",
          stream: "stderr",
          line: `langy assistant disabled: it failed to start (${err instanceof Error ? err.message : String(err)}). Everything else continues without it.`,
        });
      }
    }
    const effective = { ...features, isLangyEnabled: isLangyRunnable };
    const childEnv: Record<string, string> = {
      ...envFromFile,
      ...ctx.userEnv,
      ...featureEnv(effective),
    };
    if (!effective.isLangyEnabled) {
      // With the assistant off, the app must not think it exists: an agent
      // URL with no agent behind it turns every send into a hang, and the
      // forced rollout flag would render the panel. The .env keeps its lines
      // (they are the user's knobs); only the running processes lose them.
      delete childEnv.OPENCODE_AGENT_URL;
      const forced = (childEnv.FEATURE_FLAG_FORCE_ENABLE ?? "")
        .split(",")
        .map((f) => f.trim())
        .filter((f) => f && f !== "release_langy_enabled");
      if (forced.length > 0) childEnv.FEATURE_FLAG_FORCE_ENABLE = forced.join(",");
      else delete childEnv.FEATURE_FLAG_FORCE_ENABLE;
    }

    // nlpgo is the only NLP runtime — the Go service from the aigateway
    // monobinary, dispatched as `nlpgo`. It binds to ctx.ports.nlp; the
    // langwatch app's /studio/* routing always targets /go/*.
    //
    // allSettled, not all: with all(), one service failing its health probe
    // rejects the combinator and DISCARDS the handles of the services that
    // had already started — stopHandles never sees them, and every partial
    // boot leaks live nlpgo/gateway processes that then squat the port slot
    // and force the next run to auto-shift.
    const results = await Promise.allSettled([
      startNlpgo(ctx, bus, childEnv),
      startLangevals(ctx, bus, childEnv),
      startAigateway(ctx, bus, envFromFile),
      startLangwatch(ctx, bus, childEnv),
    ]);
    for (const r of results) {
      if (r.status === "fulfilled") handles.push(r.value);
    }
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) {
      await stopHandles(handles);
      throw failure.reason;
    }

    try {
      // Phase 3b: workers. Spawned AFTER the app is healthy so it can
      // share the same boot env (Redis + Prisma already migrated, app
      // listening). Without these, the BullMQ collector/evaluations/
      // track-event/topic-clustering queues fill up with no consumer and
      // the UI sits forever on "Waiting for first trace…". The await is
      // for resolvePnpm() inside startLangwatchWorkers — the spawn itself
      // is non-blocking; lifecycle is inferred from process state.
      const workers = await startLangwatchWorkers(ctx, bus, childEnv);
      handles.push(workers);
    } catch (err) {
      await stopHandles(handles);
      throw err;
    }

    return handles.map(toServiceHandle);
  },

  async waitForHealth() {
    // startAll already gates on every individual health probe. Keep this
    // as a no-op cross-check so the CLI's [4/4] phase has somewhere to land.
  },

  async stopAll(handles) {
    await stopHandles(handles);
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

function toServiceHandle(h: SupervisedHandle): ServiceHandle {
  return { name: h.name, pid: h.pid, stop: h.stop };
}

export const runtime = runtimeImpl;
export type { RuntimeApi, RuntimeContext, RuntimeEvent, ServiceHandle };
