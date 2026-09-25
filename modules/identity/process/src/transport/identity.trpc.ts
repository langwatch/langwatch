/**
 * The server half of `identity.*`: the session user's own identity. No permission applies and
 * none is missing — the session proves who the caller is, and every operation acts on that user
 * alone. Spec: specs/identity/identifier-model.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { IdentityApi, identityTrpc } from "@langwatch/identity-contract";

const OWN_VERIFICATION_RECORD =
  "completes the session user's own email verification; the ceremony proves the record is pinned to that user, and no organization scope applies";
const OWN_TEST_ARRIVAL =
  "answers where the session user's own sign-in leaves them; the caller usually belongs to no organization yet, which is the condition being reported";
const OWN_IDENTIFIERS =
  "lists the session user's own sign-in identifiers; no organization scope applies and no other account is reachable";
const OWN_METHODS_LAST_USED =
  "reads when the session user's own sign-in methods last minted a session; no organization scope applies and no other account is reachable";
const OWN_ADD_IDENTIFIER =
  "adds an identifier to the session user's own account; no organization scope applies";
const OWN_RESEND_CONFIRMATION =
  "re-sends the session user's own address confirmation; the ceremony proves the identifier is theirs";
const OWN_REMOVE_IDENTIFIER =
  "removes an identifier from the session user's own account; the identity guards decide, and no organization scope applies";

export const identityTrpcTransport = defineTrpcRouter(IdentityApi, identityTrpc)
  .procedure("completeVerification")
  .noPermission({ reason: OWN_VERIFICATION_RECORD })
  .handle(async ({ app, actor, input }) => {
    await app.completeEmailVerification({ userId: actor.id, ...input });

    return { verified: true as const };
  })

  .procedure("myTestArrival")
  .noPermission({ reason: OWN_TEST_ARRIVAL })
  .handle(({ app, actor }) => app.ssoTestArrival().standingFor({ userId: actor.id }))

  .procedure("myIdentifiers")
  .noPermission({ reason: OWN_IDENTIFIERS })
  .handle(({ app, actor }) => app.listAccountIdentifiers({ userId: actor.id }))

  .procedure("myMethodsLastUsed")
  .noPermission({ reason: OWN_METHODS_LAST_USED })
  .handle(({ app, actor }) => app.getMethodsLastUsed({ userId: actor.id }))

  .procedure("addEmailIdentifier")
  .noPermission({ reason: OWN_ADD_IDENTIFIER })
  .handle(({ app, actor, input }) => app.addEmailIdentifier({ userId: actor.id, ...input }))

  .procedure("resendIdentifierConfirmation")
  .noPermission({ reason: OWN_RESEND_CONFIRMATION })
  .handle(async ({ app, actor, input }) => {
    await app.resendIdentifierConfirmation({ userId: actor.id, ...input });

    return { sent: true as const };
  })

  .procedure("removeIdentifier")
  .noPermission({ reason: OWN_REMOVE_IDENTIFIER })
  .handle(async ({ app, actor, input }) => {
    await app.removeIdentifier({ userId: actor.id, identifierId: input.identifierId });

    return { removed: true as const };
  })
  .build();
