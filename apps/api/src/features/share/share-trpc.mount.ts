/**
 * Binds the feature's declared procedures to this process's execution path.
 * Every procedure here is authenticated; the one anonymous share surface is
 * `sharedTrace.get`, which ADR-057 keeps separate and this mount never sees.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { ShareApi } from "@langwatch/share-contract";
import { pinnedTraceTrpcTransport, shareTrpcTransport } from "@langwatch/share-server";

/** The one slice of the process context these two namespaces read. */
export interface ShareHostContext {
  app: Readonly<{ share: ShareApi }>;
}

export function createShareTrpcRouter<TContext extends ShareHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(shareTrpcTransport, (ctx) => ctx.app.share);
}

export function createPinnedTraceTrpcRouter<TContext extends ShareHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(pinnedTraceTrpcTransport, (ctx) => ctx.app.share);
}
