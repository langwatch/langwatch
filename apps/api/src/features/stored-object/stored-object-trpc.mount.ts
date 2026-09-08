/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { storedObjectTrpcTransport } from "@langwatch/stored-object-server";

/** The one slice of the process context this namespace reads. */
export interface StoredObjectHostContext {
  app: Readonly<{ storedObjectApp: StoredObjectApi }>;
}

export function createStoredObjectTrpcRouter<TContext extends StoredObjectHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(storedObjectTrpcTransport, (ctx) => ctx.app.storedObjectApp);
}
