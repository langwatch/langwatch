/**
 * ComposedPresenceFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { PresenceService } from "@langwatch/presence-contract";
import type { BroadcastAdapter, PresenceEmitterPort } from "@langwatch/presence-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createPresenceTrpcRouter } from "./presence-trpc.mount";

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
