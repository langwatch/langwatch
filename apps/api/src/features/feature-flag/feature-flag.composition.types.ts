/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createFeatureFlagTrpcRouter } from "./feature-flag-trpc.mount.ts";

/** The namespace and the one app every other rollout gate reads. */
export type ComposedFeatureFlagFeature = Readonly<{
  /** The `ctx.app.featureFlag` slice. */
  app: FeatureFlagApi;
  /** `featureFlag.*`. Takes no ports: it answers from `ctx.app.featureFlag`. */
  router(
    mount: ApiTrpcFeatureMount,
  ): ReturnType<typeof createFeatureFlagTrpcRouter<ApiTrpcContext>>;
}>;
