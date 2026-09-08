/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { dataRetentionTrpcTransport } from "@langwatch/data-retention-server";

/** The one slice of the process context this namespace reads. */
export interface DataRetentionHostContext {
  app: Readonly<{ dataRetention: DataRetentionApi }>;
}

export function createDataRetentionTrpcRouter<TContext extends DataRetentionHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(dataRetentionTrpcTransport, (ctx) => ctx.app.dataRetention);
}
