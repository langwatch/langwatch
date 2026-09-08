/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { monitorTrpcTransport } from "@langwatch/monitor-server";

/**
 * The one slice of the process context the `monitors` namespace reads.
 *
 * `monitors` is also the wire namespace the browser calls and the key tRPC
 * hashes into its query cache, so the two spellings are the same on purpose.
 */
export interface MonitorHostContext {
  app: Readonly<{ monitors: MonitorApi }>;
}

/** Mounts `monitors.*`. */
export function createMonitorTrpcRouter<TContext extends MonitorHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(monitorTrpcTransport, (ctx) => ctx.app.monitors);
}
