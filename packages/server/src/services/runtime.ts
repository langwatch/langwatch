// julia's lane: orchestrator that implements RuntimeApi.
// Wired up by the CLI via dynamic import — see shared/runtime-placeholder.ts.

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
import { startLangwatchNlp } from "./langwatch-nlp.ts";
import { runMigrations } from "./migrate.ts";
import { ensureLangwatchDeps } from "./node-deps.ts";
import { startPostgres } from "./postgres.ts";
import { startRedis } from "./redis.ts";
import { syncVenvs } from "./venvs.ts";
import type { SupervisedHandle } from "./spawn.ts";

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
  async scaffoldEnv(ctx) {
    return scaffoldEnv(ctx);
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
    await Promise.all([
      syncVenvs(ctx, bus),
      ensureLangwatchDeps(ctx, bus),
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
    // win over the blank .env entries written by scaffoldEnvFile.
    const childEnv = { ...envFromFile, ...ctx.userEnv };

    try {
      const [nlp, langevals, gw, lw] = await Promise.all([
        startLangwatchNlp(ctx, bus, childEnv),
        startLangevals(ctx, bus, childEnv),
        startAigateway(ctx, bus, envFromFile),
        startLangwatch(ctx, bus, childEnv),
      ]);
      handles.push(nlp, langevals, gw, lw);
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
