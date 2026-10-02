import { nowInstant } from "@langwatch/time";

import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { locateWorkerDir, resolvePnpm } from "./node-deps.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * The LangWatch worker process. Healthy once its health door answers, which
 * opens after its prepare step and composition. The launcher already migrated
 * and the api already provisioned, so the worker skips both.
 */
export async function startLangwatchWorkers(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "workers" });
  const start = nowInstant().epochMilliseconds;
  const healthPort = envFromFile.WORKER_METRICS_PORT ?? "2999";

  const workerDir = locateWorkerDir();
  if (!workerDir) throw new Error("langwatch worker dir not found");

  const sp = servicePaths(ctx.paths);
  const pnpm = await resolvePnpm(ctx.paths);
  const handle = supervise({
    spec: {
      name: "workers",
      command: pnpm.command,
      args: [...pnpm.args, "run", "start"],
      cwd: workerDir,
      env: {
        ...process.env,
        ...envFromFile,
        // ctx.paths.bin first so the bundled pnpm is reachable to nested
        // invocations; matches startLangwatch.
        PATH: `${ctx.paths.bin}:${process.env.PATH ?? ""}`,
        NODE_ENV: "production",
        // PORT isn't used by workers but we set it for symmetry with the
        // app — some shared bootstrap code reads it for log tagging.
        PORT: String(ctx.ports.langwatch),
        WORKER_METRICS_PORT: healthPort,
        SKIP_PRISMA_MIGRATE: "true",
        SKIP_CLICKHOUSE_MIGRATE: "true",
        SKIP_LWQL_PROVISION: "true",
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${healthPort}/healthz`),
    timeoutMs: 120_000,
    intervalMs: 1000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`workers did not become healthy: ${ready.reason}`);
  }
  bus.emit({
    type: "healthy",
    service: "workers",
    durationMs: nowInstant().epochMilliseconds - start,
  });

  return handle;
}
