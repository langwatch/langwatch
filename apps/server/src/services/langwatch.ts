import { nowInstant } from "@langwatch/time";

import { DEFAULT_LOG_LEVEL } from "../shared/log-level.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { locateBackendDir, resolvePnpm } from "./node-deps.ts";
import { appOfflineEnv, FORCED_ENV } from "./offline-defaults.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * The langwatch backend, launched via `pnpm run start` in apps/backend: the api (serving the
 * browser bundle apps/ui built) and the worker in one process, on the internal port the CLI's
 * door forwards to. The worker runs the upgrade, so nothing here migrates.
 */

/** The app tree carries its own node_modules: the prebuilt app, or the developer's checkout. */
export async function startLangwatch(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langwatch" });
  const start = nowInstant().epochMilliseconds;

  const backendDir = locateBackendDir();
  if (!backendDir) throw new Error("langwatch backend dir not found");

  const sp = servicePaths(ctx.paths);
  const pnpm = await resolvePnpm(ctx.paths);
  const handle = supervise({
    spec: {
      name: "langwatch",
      command: pnpm.command,
      args: [...pnpm.args, "run", "start"],
      cwd: backendDir,
      env: {
        // Defaults first so the user's shell and .env override them.
        ...appOfflineEnv({ paths: ctx.paths, appRootDir: appRoot() }),
        ...process.env,
        ...envFromFile,
        ...FORCED_ENV,
        // ctx.paths.bin puts the bundled pnpm on PATH for the nested pnpm calls in the app's
        // own scripts (prisma migrate, lwql-provision) on boxes with no global install.
        PATH: `${ctx.paths.bin}:${process.env.PATH ?? ""}`,
        NODE_ENV: "production",
        // API_PORT is the API process's own name for it; PORT stays as the last entry in its
        // precedence list and as the value nested tooling reads. Both carry the internal port:
        // BASE_HOST keeps the public one, which the CLI's door forwards here.
        API_PORT: String(ctx.ports.backend),
        PORT: String(ctx.ports.backend),
        LOG_LEVEL: ctx.logLevel ?? DEFAULT_LOG_LEVEL,
        // The worker half's own health door, on the slot ports.ts allocated.
        WORKER_METRICS_PORT: String(ctx.ports.workerHealth),
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    handle,
    // The api half's /api/health returns 204 No Content (apiHealthRoute in
    // apps/api/src/main.ts), the helm chart's liveness signal too. One wait
    // covers the process: a worker that refuses boot exits it.
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.backend}/api/health`, {
      expectStatus: 204,
    }),
    timeoutMs: 120_000,
    intervalMs: 1000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`langwatch did not become healthy: ${ready.reason}`);
  }
  bus.emit({
    type: "healthy",
    service: "langwatch",
    durationMs: nowInstant().epochMilliseconds - start,
  });
  return handle;
}
