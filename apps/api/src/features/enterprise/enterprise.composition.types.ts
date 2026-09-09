/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context.ts";

/** The two `ctx.app` slices this feature answers. The four tRPC namespaces are
 * not here: their transport is unconverted. */
export type ComposedEnterpriseFeature = Readonly<{
  /** For `ctx.app.licensing` and `ctx.app.usageLimits`. */
  application: Pick<ApiTrpcFeatureApplication, "licensing" | "usageLimits">;
}>;
