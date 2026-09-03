/**
 * App-process transport mount for the feature-flag vertical.
 *
 * Behaviour is package-owned (`@langwatch/feature-flag-server`); this supplies
 * the process's root and the one procedure the surface builds on.
 *
 * It takes NO ports and no declared-permission policy, and both are the same
 * decision. Every flag procedure authorizes the exact tenant target it was
 * asked for INSIDE the package's own resolver — a project against the
 * organization that actually owns it, an organization against membership — and
 * that target is not the scope id the input carries. So the process declares
 * the service-authorized claim once, for the whole surface, and its fail-closed
 * backstop still refuses a procedure no check ran on.
 */
import { createTrpcApiService, type TrpcApiMount } from "@langwatch/api/trpc";
import { FeatureFlagTrpcApi, type FeatureFlagTrpcContext } from "@langwatch/feature-flag-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Mounts `featureFlag.*` on the app process's tRPC root. */
export function createFeatureFlagTrpcRouter<
  TContext extends FeatureFlagTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  const service = createTrpcApiService(mount);
  return FeatureFlagTrpcApi.create(mount.root, {
    protected: service.serviceAuthorized({
      reason:
        "the feature package's resolver authorizes the exact tenant target before any flag is read or written",
      permissions: ["project:view", "organization:view", "featureFlags:manageExperiments"],
    })(service.protected),
  });
}
