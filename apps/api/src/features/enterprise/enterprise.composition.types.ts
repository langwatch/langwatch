/**
 * ComposedEnterpriseFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
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
