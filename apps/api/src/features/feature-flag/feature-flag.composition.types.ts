/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createFeatureFlagTrpcRouter } from "./feature-flag-trpc.mount";

/** The namespace and the one service every other rollout gate reads. */
export type ComposedFeatureFlagFeature = Readonly<{
  /** `featureFlag.*`. Takes no ports: it answers from `ctx.app.featureFlags`. */
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createFeatureFlagTrpcRouter>;
  /** For `ctx.app.featureFlags`, for the shared infrastructure, and for peers. */
  service: FeatureFlagService;
}>;
