import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { locateLangwatchDir } from "./node-deps.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * The langwatch BullMQ worker process. Drains queues populated by the
 * langwatch app: collector (raw OTEL spans → trace_summaries +
 * stored_spans), evaluations, track-events, topic-clustering, usage stats.
 *
 * Without these workers, anything you do in the UI that depends on a
 * processed trace (the /messages list, /analytics, evaluator runs) sits
 * forever showing "Waiting for first trace…". The npx flow used to spawn
 * only `start:app` (= the API server) and skip workers entirely; this
 * service closes the gap so npx parity matches `pnpm dev`.
 *
 * No HTTP health probe — the workers don't expose a port. Health is
 * inferred from process liveness; if it crashes, supervise() emits the
 * crash event and the user sees it in the log stream.
 */
export function startLangwatchWorkers(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): SupervisedHandle {
  bus.emit({ type: "starting", service: "workers" });

  const langwatchDir = locateLangwatchDir();
  if (!langwatchDir) throw new Error("langwatch app dir not found");

  const sp = servicePaths(ctx.paths);
  const handle = supervise({
    spec: {
      name: "workers",
      command: "pnpm",
      args: ["run", "start:workers"],
      cwd: langwatchDir,
      env: {
        ...process.env,
        ...envFromFile,
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
  // "trace worker active" / "collector worker active" log lines as they
  // boot, which the user sees streamed via the log-tee. The app already
  // gates startup behind the API server's /api/health probe, so by the
  // time we get here Redis + ClickHouse are reachable.
  bus.emit({ type: "healthy", service: "workers", durationMs: 0 });

  return handle;
}
