import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { locateWorkerDir, resolvePnpm } from "./node-deps.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

// LangWatch worker process. Health inferred from process liveness.
export async function startLangwatchWorkers(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "workers" });

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
      },
    },
    paths: sp,
    bus,
  });

  // Mark healthy synchronously after spawn — workers print their own
  // "topic clustering worker ready" / "ingestion puller worker ready" log
  // lines as they boot, which the user sees streamed via the log-tee. The app already
  // gates startup behind the API server's /api/health probe, so by the
  // time we get here Redis + ClickHouse are reachable.
  bus.emit({ type: "healthy", service: "workers", durationMs: 0 });

  return handle;
}
