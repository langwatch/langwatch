/**
 * ComposedLangyFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { LangyApp } from "@langwatch/langy-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createLangyEgressTrpcRouter, createLangyTrpcRouter } from "./langy-trpc.mount";

/** The Langy application and the two routers built over it. */
export type ComposedLangyFeature = Readonly<{
  /** The `ctx.app.langy` slice both Langy doors read. */
  app: LangyApp;
  /** `langy.*` and `langyEgress.*`, behind the same two process gates. */
  routers(mount: ApiTrpcFeatureMount): {
    langy: ReturnType<typeof createLangyTrpcRouter>;
    langyEgress: ReturnType<typeof createLangyEgressTrpcRouter>;
  };
}>;
