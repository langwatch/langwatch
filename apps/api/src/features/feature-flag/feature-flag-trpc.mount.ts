/**
 * Binds the feature's declared procedures to this process's execution path.
 * The surface takes no ports of its own.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { featureFlagTrpcTransport } from "@langwatch/feature-flag-server";

/** The one slice of the process context this namespace reads. */
export interface FeatureFlagHostContext {
  app: Readonly<{ featureFlag: FeatureFlagApi }>;
}

/**
 * Mounts `featureFlag.*` on this process's root. Every procedure authorizes
 * the exact tenant target inside the feature's own app — a project against
 * the organization that owns it, an organization against membership — which
 * is why each declaration is service-authorized rather than naming a scope.
 */
export function createFeatureFlagTrpcRouter<TContext extends FeatureFlagHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(featureFlagTrpcTransport, (ctx) => ctx.app.featureFlag);
}
