/**
 * The server half of `featureFlag.*`: an access decision and a handler per
 * procedure. Every one is service-authorized — the app authorizes the
 * exact tenant target, not the scope id a declaration would read off input.
 */

import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { FeatureFlagApi, featureFlagTrpc } from "@langwatch/feature-flag-contract";
import { z } from "zod";

const AUTHORIZED_BY_THE_APP =
  "the feature's own resolver authorizes the exact tenant target before any flag is read or written";

const TENANT_READ_PERMISSIONS = ["project:view", "organization:view"] as const;
const EXPERIMENT_PERMISSIONS = [
  "project:view",
  "organization:view",
  "featureFlags:manageExperiments",
] as const;

/** The session's email, for an email domain rule — bound once at the process
 * (matched to `organization.trpc.ts`'s fact by name, not import). */
const callerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());

export const featureFlagTrpcTransport = defineTrpcRouter(FeatureFlagApi, featureFlagTrpc)
  .procedure("isEnabled")
  .withFacts(callerEmailFact)
  .serviceAuthorized({
    reason: AUTHORIZED_BY_THE_APP,
    permissions: TENANT_READ_PERMISSIONS,
  })
  .handle(async ({ app, input, actor }, callerEmail) => ({
    enabled: await app.isEnabledForCaller({
      ...input,
      userId: actor.id,
      userEmail: callerEmail ?? undefined,
    }),
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
