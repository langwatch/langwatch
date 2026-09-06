/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { LangyApp } from "@langwatch/langy-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createLangyEgressTrpcRouter, createLangyTrpcRouter } from "./langy-trpc.mount.ts";

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
