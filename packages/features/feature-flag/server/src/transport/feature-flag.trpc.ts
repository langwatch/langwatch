/**
 * The server half of `featureFlag.*`: an access decision and a handler per
 * procedure the contract already named. Every one is service-authorized —
 * the app authorizes the exact tenant target, which is not the scope id a
 * declaration would read off the input.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { FeatureFlagApi, featureFlagTrpc } from "@langwatch/feature-flag-contract";

const AUTHORIZED_BY_THE_APP =
  "the feature's own resolver authorizes the exact tenant target before any flag is read or written";

const TENANT_READ_PERMISSIONS = ["project:view", "organization:view"] as const;
const EXPERIMENT_PERMISSIONS = [
  "project:view",
  "organization:view",
  "featureFlags:manageExperiments",
] as const;

export const featureFlagTrpcTransport = defineTrpcRouter(FeatureFlagApi, featureFlagTrpc)
  .procedure("isEnabled")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: TENANT_READ_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }) => ({
    enabled: await app.isEnabledForCaller({ ...input, userId: actor.id }),
  }))

  .procedure("isEnabledForAnyOrganization")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: TENANT_READ_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }) => {
    const byOrganization = await app.isEnabledByOrganizationForCaller({
      ...input,
      userId: actor.id,
    });

    return { enabled: Object.values(byOrganization).some(Boolean) };
  })

  .procedure("isEnabledForEachOrganization")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: TENANT_READ_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }) => ({
    enabledByOrganizationId: await app.isEnabledByOrganizationForCaller({
      ...input,
      userId: actor.id,
    }),
  }))

  .procedure("resolve")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: TENANT_READ_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }) => ({
    flags: await app.resolveFrontendFlagsForCaller({ ...input, userId: actor.id }),
  }))

  .procedure("experiments")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: EXPERIMENT_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }) => ({
    experiments: await app.listExperimentsForCaller({ ...input, userId: actor.id }),
  }))

  .procedure("setExperimentEnrolment")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: TENANT_READ_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }) => {
    await app.setExperimentEnrolmentForCaller({ ...input, userId: actor.id });

    return { ok: true } as const;
  })

  .procedure("setExperimentTenantPolicy")
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: ["featureFlags:manageExperiments"],
  })
  .handle(async ({ app, input, actor }) => {
    await app.setExperimentTenantPolicyForCaller({ ...input, userId: actor.id });

    return { ok: true } as const;
  })
  .build();
