/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type {
  createOrganizationSpendTrpcRouter,
  createPlanTrpcRouter,
  createUsageLimitsTrpcRouter,
} from "./entitlement-trpc.mount.ts";

/** The three namespaces, and the one capability behind all of them. */
export type ComposedEntitlementFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    plan: ReturnType<typeof createPlanTrpcRouter<ApiTrpcContext>>;
    limits: ReturnType<typeof createUsageLimitsTrpcRouter<ApiTrpcContext>>;
    costs: ReturnType<typeof createOrganizationSpendTrpcRouter<ApiTrpcContext>>;
  };
  /**
   * For `ctx.app.planProvider`, which every banner, ingest guard and seat check
   * on this process resolves its allowance through.
   */
  app: EntitlementApi;
}>;
