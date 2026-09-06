/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createSavedViewTrpcRouter } from "./dashboard-trpc.mount";

/** The one namespace, built over this process's own connection. */
export type ComposedSavedViewFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createSavedViewTrpcRouter>;
}>;
