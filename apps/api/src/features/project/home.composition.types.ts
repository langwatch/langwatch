/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createHomeTrpcRouter } from "./project-trpc.mount";

/** The one namespace this feature mounts. */
export type ComposedHomeFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createHomeTrpcRouter>;
}>;
