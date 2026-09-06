/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { PresenceService } from "@langwatch/presence-contract";
import type { BroadcastAdapter, PresenceEmitterPort } from "@langwatch/presence-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createPresenceTrpcRouter } from "./presence-trpc.mount.ts";

/** The one namespace this feature mounts, and the two slices behind it. */
export type ComposedPresenceFeature = Readonly<{
  /** The `ctx.app.presence` slice. */
  app: PresenceService;
  /** The `ctx.app.broadcast` slice, which the export relay reads too. */
  emitter: PresenceEmitterPort;
  /**
   * The fan-out itself, for the REST families and the three subscription surfaces that
   * broadcast on it. Absent on a process that composed no presence graph, so each of them
   * refuses by name rather than publishing into a fabric nobody subscribed to.
   */
  broadcast: BroadcastAdapter | undefined;
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createPresenceTrpcRouter>;
}>;
