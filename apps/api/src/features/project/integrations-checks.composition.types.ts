/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createIntegrationsChecksTrpcRouter } from "./project-trpc.mount";

/** The one namespace, built over the composed rollup. */
export type ComposedIntegrationsChecksFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createIntegrationsChecksTrpcRouter>;
}>;
