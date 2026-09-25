/**
 * The server half of `twoStepVerification.*` (D06). The account read acts on the session's
 * own user and needs no scope; the member list is an administrator's, under
 * `organization:manage`. Spec: specs/identity/mfa-and-session-shape.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { TwoStepVerificationApi, twoStepVerificationTrpc } from "@langwatch/identity-contract";

const OWN_TWO_STEP =
  "the caller's own two-step verification, answered for the session's user id alone";

export const twoStepVerificationTrpcTransport = defineTrpcRouter(
  TwoStepVerificationApi,
  twoStepVerificationTrpc,
)
  .procedure("account")
  .noPermission({ reason: OWN_TWO_STEP })
  .handle(({ app, actor }) => app.getTwoStepAccountStanding({ userId: actor.id }))

  .procedure("memberFactors")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.findOrganizationMemberFactors({ organizationId: input.organizationId }),
  )
  .build();
