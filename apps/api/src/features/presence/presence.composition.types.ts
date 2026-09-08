/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PresenceApi } from "@langwatch/presence-contract";
import type { BroadcastAdapter, PresenceEmitterPort } from "@langwatch/presence-server";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createPresenceTrpcRouter } from "./presence-trpc.mount.ts";

/** The one namespace this feature mounts, and the two slices behind it. */
export type ComposedPresenceFeature = Readonly<{
  /** The `ctx.app.presence` slice. */
  app: PresenceApi;
  /** The `ctx.app.broadcast` slice, which the export relay reads too. */
  emitter: PresenceEmitterPort;
  /**
   * The fan-out itself, for the REST families and the three subscription surfaces that
   * broadcast on it.
   */
  broadcast: BroadcastAdapter;
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createPresenceTrpcRouter<ApiTrpcContext>>;
}>;
