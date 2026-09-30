// Frontend query for caller's permissions; declared here to avoid package cycle.
import type { Actor } from "@langwatch/actor";
import { toLedgerActor } from "@langwatch/actor";
import { defineTrpcContract } from "@langwatch/api/contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  AuthzApi,
  authzChangeGrantRoleInputSchema,
  authzCreateGrantInputSchema,
  authzListGrantsInputSchema,
  authzOwnStandingInputSchema,
  authzOwnStandingSchema,
  authzRevokeGrantByIdInputSchema,
  grantPageSchema,
  grantRevokedSchema,
  grantSchema,
  type AuthzPrincipalRef,
} from "@langwatch/authz-contract";

/** Whose permissions bound a grant is the session's, so the input never names it. */
const IMPLIED_BY_SESSION = { caller: true, actor: true } as const;

export const authzTrpc = defineTrpcContract("authz")
  .query("effectivePermissions", { cache: { tier: "session" } })
  .withInput(authzOwnStandingInputSchema)
  .withOutput(authzOwnStandingSchema)

  .query("listGrants")
  .withInput(authzListGrantsInputSchema)
  .withOutput(grantPageSchema)

  .mutation("createGrant")
  .withInput(authzCreateGrantInputSchema.omit(IMPLIED_BY_SESSION))
  .withOutput(grantSchema)

  .mutation("changeGrantRole")
  .withInput(authzChangeGrantRoleInputSchema.omit(IMPLIED_BY_SESSION))
  .withOutput(grantSchema)

  .mutation("revokeGrant")
  .withInput(authzRevokeGrantByIdInputSchema.omit({ actor: true }))
  .withOutput(grantRevokedSchema)
  .build();

/** The session as the escalation ceiling: a person, or the key a CLI session arrived on. */
function callerOf(actor: Actor): AuthzPrincipalRef {
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "apiKey", id: actor.id };

  return { type: "anonymous" };
}

/**
 * Membership itself is the only requirement for the standing: the answer is the
 * caller's own, and a non-member resolves to the empty set. The grant writes sit
 * at `organization:manage`, as `/api/grants` does, and never exceed the caller.
 */
export const authzTrpcTransport: TrpcRouterDeclaration<AuthzApi, typeof authzTrpc> =
  defineTrpcRouter(AuthzApi, authzTrpc)
    .procedure("effectivePermissions")
    .serviceAuthorized({
      reason:
        "resolves the caller's OWN effective permissions at the project or organization scope named; a non-member resolves to the empty set (no default access)",
      permissions: [],
    })
    .handle(async ({ app, input, actor }) => app.effectivePermissionsFor(input, { id: actor.id }))

    .procedure("listGrants")
    .withPermission("organization:manage")
    .handle(async ({ app, input }) => app.listGrants(input))

    .procedure("createGrant")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.createGrant({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    .procedure("changeGrantRole")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.changeGrantRole({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    .procedure("revokeGrant")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.revokeGrant({ ...input, actor: toLedgerActor(actor) }),
    )
    .build();
