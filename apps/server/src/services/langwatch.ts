import { existsSync } from "node:fs";
import { join } from "node:path";

import { nowInstant } from "@langwatch/time";
import { execa } from "execa";

import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { locateBackendDir, resolvePnpm } from "./node-deps.ts";
import { appOfflineEnv, FORCED_ENV } from "./offline-defaults.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * The langwatch backend, launched via `pnpm run start` in apps/backend: the
 * api (serving the browser bundle apps/ui built) and the worker in one Node
 * process. The worker runs the upgrade, so nothing here migrates or skips it.
 */

/**
 * node_modules is installed on first run if missing: the npm tarball
 * ships source, not deps, to keep the package small.
 */
export async function startLangwatch(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langwatch" });
  const start = nowInstant().epochMilliseconds;

  const backendDir = locateBackendDir();
  if (!backendDir) throw new Error("langwatch backend dir not found");
  await ensureNodeModules(backendDir, ctx, bus);

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
        ...appOfflineEnv(ctx.paths),
        ...process.env,
        ...envFromFile,
        ...FORCED_ENV,
        // Prepend ctx.paths.bin so the bundled pnpm is reachable to any
        // nested pnpm calls inside langwatch's own scripts. Without this,
        // `sh -c '... pnpm ...'` subshells can't find pnpm on bare-Linux
        // boxes that have no global pnpm install.
        PATH: `${ctx.paths.bin}:${process.env.PATH ?? ""}`,
        NODE_ENV: "production",
        // API_PORT is the API process's own name for it; PORT stays as the
        // last entry in its precedence list and as the value nested tooling
        // reads, so both are set to the one number.
        API_PORT: String(ctx.ports.langwatch),
        PORT: String(ctx.ports.langwatch),
        // The worker half's own health door, on the slot ports.ts allocated.
        WORKER_METRICS_PORT: String(ctx.ports.workerHealth),
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    // The api half's /api/health returns 204 No Content (apiHealthRoute in
    // apps/api/src/main.ts), the helm chart's liveness signal too. One wait
    // covers the process: a worker that refuses boot exits it.
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.langwatch}/api/health`, {
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

async function ensureNodeModules(
  langwatchDir: string,
  ctx: RuntimeContext,
  bus: EventBus,
): Promise<void> {
  if (existsSync(join(langwatchDir, "node_modules"))) return;
  bus.emit({
    type: "log",
    service: "langwatch",
    stream: "stdout",
    line: "installing node_modules (one-time setup)...",
  });
  // Defensive fallback for upgrade flows where node_modules went missing
  // but the runtime was already started — ensureLangwatchDeps is the
  // primary path. resolvePnpm(paths) prefers the bundled <bin>/pnpm
  // installed by the pnpm predep.
  const pnpm = await resolvePnpm(ctx.paths);
  await execa(pnpm.command, [...pnpm.args, "install", "--prod=false", "--frozen-lockfile"], {
    cwd: langwatchDir,
    stdio: "inherit",
  });
}
