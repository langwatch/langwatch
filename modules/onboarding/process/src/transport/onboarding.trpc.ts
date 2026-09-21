/**
 * The server half of `onboarding.*`: every guided-onboarding read and write
 * is the caller's own organization state, authorized at the exact tenant.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OnboardingApi, onboardingTrpc } from "@langwatch/onboarding-contract";

const AUTHORIZED_BY_THE_APP =
  "guided-onboarding state is the organization's own; the app authorizes the exact organizationId before any read or write";

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
  .build();
