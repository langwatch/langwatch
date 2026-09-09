/**
 * The server half of `identity.*`. No permission applies and none is missing:
 * the session proves who the caller is and the ceremony proves the record is
 * pinned to them, so the ids in the input widen no scope.
 * Spec: specs/identity/identifier-model.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { identityTrpc, UserApi } from "@langwatch/user-contract";

const OWN_VERIFICATION_RECORD =
  "completes the session user's own email verification; the ceremony proves the record is pinned to that user, and no organization scope applies";

export const identityTrpcTransport = defineTrpcRouter(UserApi, identityTrpc)
  .procedure("completeVerification")
  .noPermission({ reason: OWN_VERIFICATION_RECORD })
  .handle(({ app, actor, input }) =>
    app.completeEmailVerification({ userId: actor.id, ...input }),
  )
  .build();
