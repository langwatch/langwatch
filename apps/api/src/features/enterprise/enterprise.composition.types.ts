/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";

/** The three `ctx.app` slices and the SCIM REST door. The four tRPC namespaces
 * are not here: their transport is unconverted. */
export type ComposedEnterpriseFeature = Readonly<{
  /** For `ctx.app.licensing`, `ctx.app.scimApp` and `ctx.app.usageLimits`. */
  application: Pick<ApiTrpcFeatureApplication, "licensing" | "scimApp" | "usageLimits">;
  /**
   * The SCIM application the packaged REST family serves, where this process composed the
   * feature at all.
   */
  scim?: ApiTrpcFeatureApplication["scimApp"] | undefined;
}>;
