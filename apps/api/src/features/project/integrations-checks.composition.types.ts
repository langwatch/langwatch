/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createIntegrationsChecksTrpcRouter } from "./project-trpc.mount.ts";

/** The one namespace, built over the composed rollup. */
export type ComposedIntegrationsChecksFeature = Readonly<{
  router(
    mount: ApiTrpcFeatureMount,
  ): ReturnType<typeof createIntegrationsChecksTrpcRouter<ApiTrpcContext>>;
}>;
