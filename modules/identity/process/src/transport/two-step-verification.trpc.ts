/**
 * The server half of `twoStepVerification.*` (D06). The account procedures act on the
 * session's own user; the organization's are an administrator's, under `organization:manage`.
 * Spec: specs/identity/mfa-and-session-shape.feature.
 */
import { browserSessionFact, defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import {
  requestHeaderRecordSchema,
  TwoStepVerificationApi,
  twoStepVerificationTrpc,
} from "@langwatch/identity-contract";

const OWN_TWO_STEP =
  "the caller's own two-step verification, answered for the session's user id alone";

/** The headers the request arrived with, bound by identity's own install, as auth's is. */
export const twoStepRequestHeadersFact = defineTrpcFact(
  "twoStepRequestHeaders",
  requestHeaderRecordSchema.nullable().transform((record) => record ?? {}),
);

export const twoStepVerificationTrpcTransport = defineTrpcRouter(
  TwoStepVerificationApi,
  twoStepVerificationTrpc,
)
  .procedure("account")
  .noPermission({ reason: OWN_TWO_STEP })
  .handle(({ app, actor }) => app.getTwoStepAccountStanding({ userId: actor.id }))

  .procedure("disable")
  .withFacts(twoStepRequestHeadersFact)
  .noPermission({
    reason:
      "the caller turning off their own two-step verification, matched on the session's user id; the password and a current code are the proof",
  })
  .handle(({ app, actor, input }, headers) =>
    app.disableTwoStepVerification({
      userId: actor.id,
      password: input.password,
      code: input.code,
      headers,
    }),
  )

  .procedure("standing")
  .withFacts(browserSessionFact)
  .noPermission({
    reason:
      "the caller asking whether an organization's second-factor requirement holds them; answered for the session's own user id, and the same shape for a member and a stranger",
    allow: { organizationId: "the organization the caller is trying to reach" },
  })
  .handle(({ app, actor, input }, browserSession) =>
    app.getOrganizationMfaStanding({
      userId: actor.id,
      organizationId: input.organizationId,
      sessionId: browserSession ?? null,
    }),
  )

  .procedure("requirement")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.getOrganizationMfaRequirement({ organizationId: input.organizationId }),
  )

  .procedure("setRequirement")
  .withPermission("organization:manage")
  .handle(({ app, actor, input }) =>
    app.setOrganizationMfaRequirement({
      organizationId: input.organizationId,
      mfaRequired: input.mfaRequired,
      actorUserId: actor.id,
    }),
  )

  .procedure("memberFactors")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.findOrganizationMemberFactors({ organizationId: input.organizationId }),
  )
  .build();
