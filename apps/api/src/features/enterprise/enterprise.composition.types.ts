/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { createEnterpriseTrpcRouters } from "./enterprise-trpc.mount";

/** The four namespaces, the three `ctx.app` slices, and the SCIM REST door. */
export type ComposedEnterpriseFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): ReturnType<typeof createEnterpriseTrpcRouters>;
  /** For `ctx.app.licensing`, `ctx.app.scimApp` and `ctx.app.usageLimits`. */
  application: Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">;
  /**
   * The SCIM application the packaged REST family serves, where this process composed the
   * feature at all.
   */
  scim?: ApiTrpcFeatureApplication["scimApp"] | undefined;
}>;
