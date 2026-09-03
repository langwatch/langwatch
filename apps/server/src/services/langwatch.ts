import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { locateApiDir, resolvePnpm } from "./node-deps.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * The langwatch API process. Launched via `pnpm run start` in apps/api, which
 * is the same entry the Docker image's CMD and the Helm chart run — and the
 * same process that serves the browser bundle apps/ui built, so this one
 * handle covers both halves of what a user opens. node_modules is installed on
 * first run if missing: the npm tarball ships source, not deps, to keep the
 * package small.
 */
export async function startLangwatch(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langwatch" });
  const start = Date.now();

  const apiDir = locateApiDir();
  if (!apiDir) throw new Error("langwatch api dir not found");
  await ensureNodeModules(apiDir, ctx, bus);

  const sp = servicePaths(ctx.paths);
  const pnpm = await resolvePnpm(ctx.paths);
  const handle = supervise({
    spec: {
      name: "langwatch",
      command: pnpm.command,
      args: [...pnpm.args, "run", "start"],
      cwd: apiDir,
      env: {
        ...process.env,
        ...envFromFile,
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
        SKIP_PRISMA_MIGRATE: "true",
        SKIP_CLICKHOUSE_MIGRATE: "true",
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    // The API process's /api/health returns 204 No Content (see
    // apps/api/src/api-process.lifecycle.ts) — that's the deliberate success
    // signal for the helm chart's liveness probe too.
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
  bus.emit({ type: "healthy", service: "langwatch", durationMs: Date.now() - start });
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
  await execa(
    pnpm.command,
    [...pnpm.args, "install", "--prod=false", "--frozen-lockfile"],
    {
      cwd: langwatchDir,
      stdio: "inherit",
    },
  );
}
