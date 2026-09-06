/**
 * ComposedFeatureFlagFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
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
