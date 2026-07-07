import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { locateLangwatchDir, resolvePnpm } from "./node-deps.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * The langwatch worker process. Runs the background workers the langwatch
 * app depends on: topic clustering, the EE ingestion puller, and the
 * scenario processor (simulation execution pool).
 *
 * Without these workers, anything you do in the UI that depends on
 * background processing (topic clustering, governance ingestion pulls,
 * simulations) silently never completes. The npx flow used to spawn only
 * `start:app` (= the API server) and skip workers entirely; this service
 * closes the gap so npx parity matches `pnpm dev`.
 *
 * Health is inferred from process liveness; if it crashes, supervise()
 * emits the crash event and the user sees it in the log stream.
 */
export async function startLangwatchWorkers(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "workers" });

  const langwatchDir = locateLangwatchDir();
  if (!langwatchDir) throw new Error("langwatch app dir not found");

  const sp = servicePaths(ctx.paths);
  const pnpm = await resolvePnpm(ctx.paths);
  const handle = supervise({
    spec: {
      name: "workers",
      command: pnpm.command,
      args: [...pnpm.args, "run", "start:workers"],
      cwd: langwatchDir,
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
