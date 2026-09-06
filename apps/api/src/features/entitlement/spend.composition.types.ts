/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createCostTrpcRouter, createLimitsTrpcRouter } from "./entitlement-trpc.mount.ts";

/** The two namespaces, built over the composed readings. */
export type ComposedSpendFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    costs: ReturnType<typeof createCostTrpcRouter>;
    limits: ReturnType<typeof createLimitsTrpcRouter>;
  };
}>;
