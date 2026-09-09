/**
 * The server half of `onboarding.*`. Both procedures run before the caller
 * belongs to any organization, so neither has a scope to be checked at. The
 * ceremony itself - the catalogue, the personal workspace, the first project,
 * the sign-up announcements - is the application's.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { onboardingTrpc, OrganizationApi } from "@langwatch/organization-contract";

import { organizationSessionPersonFact } from "./organization.trpc.ts";

const BEFORE_MEMBERSHIP = {
  reason: "onboarding runs before the user belongs to any organization",
} as const;

export const onboardingTrpcTransport = defineTrpcRouter(OrganizationApi, onboardingTrpc)
  .procedure("initializeOrganization")
  .withFacts(organizationSessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }, person) =>
    app.initializeOrganization(input, {
      id: actor.id,
      name: person?.name ?? null,
      email: person?.email ?? null,
    }),
  )

  /**
   * Records the flavour the customer picked, separately from the ceremony
   * above: the organization is created before that screen is shown.
   */
  .procedure("setIntegrationMethod")
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }) => {
    app.recordIntegrationMethod({ userId: actor.id, selection: input.integrationMethod });

    return { success: true as const };
  })
  .build();
