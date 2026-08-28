import { FeatureFlagTrpcApi } from "@langwatch/feature-flag-server";
import { declaredServiceAuthorization } from "~/server/app-layer/authz/trpc-middleware";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";

/**
 * Every feature flag procedure authorizes the exact tenant target it was
 * asked for inside the package's resolver — a project against the
 * organization that actually owns it, an organization against membership,
 * and a tenant experiment policy against `featureFlags:manageExperiments`.
 * The process declares that once, so the fail-closed
 * `enforcePermissionCheck` backstop still applies to the whole surface.
 */
const authorizedInFeatureResolver = declaredServiceAuthorization({
  reason:
    "the feature package's resolver authorizes the exact tenant target before any flag is read or written",
  permissions: ["project:view", "organization:view", "featureFlags:manageExperiments"],
});

const featureProcedure = authProtectedProcedure
  .use(tracerMiddleware)
  .use(loggerMiddleware)
  .use(handledErrorMiddleware)
  .use(authorizedInFeatureResolver)
  .use(enforcePermissionCheck)
  .use(auditLogMutations);

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const featureFlagRouter = FeatureFlagTrpcApi.create(appTrpcRoot, {
  protected: featureProcedure,
});
