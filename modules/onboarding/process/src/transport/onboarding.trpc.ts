/**
 * The server half of `onboarding.*`: every guided-onboarding read and write
 * is the caller's own organization state, authorized at the exact tenant; the
 * sign-up pair runs before the caller belongs to any organization.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import { OnboardingApi, onboardingTrpc } from "@langwatch/onboarding-contract";
import { z } from "zod";

const AUTHORIZED_BY_THE_APP =
  "guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write";

/** The signed-in person, bound by the process under this name for every namespace. */
const sessionPersonFact = defineTrpcFact(
  "organizationSessionPerson",
  z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
);

const BEFORE_MEMBERSHIP = {
  reason: "onboarding runs before the user belongs to any organization",
} as const;

export const onboardingTrpcTransport = defineTrpcRouter(OnboardingApi, onboardingTrpc)
  .procedure("getGuidedState")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.getGuidedState({ ...input, userId: actor.id }))

  .procedure("recordPaths")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.recordPaths({ ...input, userId: actor.id }))

  .procedure("recordProvider")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.recordProvider({ ...input, userId: actor.id }))

  .procedure("recordProviderSkipped")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) =>
    app.recordProviderSkipped({ ...input, userId: actor.id }),
  )

  .procedure("recordVirtualKeyReveal")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) =>
    app.recordVirtualKeyReveal({ ...input, userId: actor.id }),
  )

  .procedure("recordTour")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.recordTour({ ...input, userId: actor.id }))

  .procedure("beginPath")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.beginPath({ ...input, userId: actor.id }))

  .procedure("completePath")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.completePath({ ...input, userId: actor.id }))

  .procedure("attachConversation")
  .serviceAuthorized({ reason: AUTHORIZED_BY_THE_APP, permissions: ["organization:view"] })
  .handle(async ({ app, input, actor }) => app.attachConversation({ ...input, userId: actor.id }))

  .procedure("initializeOrganization")
  .withFacts(sessionPersonFact)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }, person) =>
    app.initializeOrganization(input, {
      id: actor.id,
      name: person?.name ?? null,
      email: person?.email ?? null,
    }),
  )

  .procedure("setIntegrationMethod")
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, input, actor }) => {
    app.recordIntegrationMethod({ userId: actor.id, selection: input.integrationMethod });

    return { success: true as const };
  })
  .build();
