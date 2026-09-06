/**
 * ComposedSpendFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createCostTrpcRouter, createLimitsTrpcRouter } from "./entitlement-trpc.mount";

/** The two namespaces, built over the composed readings. */
export type ComposedSpendFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    costs: ReturnType<typeof createCostTrpcRouter>;
    limits: ReturnType<typeof createLimitsTrpcRouter>;
  };
}>;
