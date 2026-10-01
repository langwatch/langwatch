// Frontend query for caller's permissions; declared here to avoid package cycle.
import type { Actor } from "@langwatch/actor";
import { toLedgerActor } from "@langwatch/actor";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  AuthzApi,
  authzApplyMemberBindingsInputSchema,
  authzBindingMutationSuccessSchema,
  authzChangeGrantRoleInputSchema,
  authzCreateGrantInputSchema,
  authzListGrantsInputSchema,
  authzListManagedBindingsForOrganizationInputSchema,
  authzListManagedBindingsForOrganizationOutputSchema,
  authzListManagedBindingsForUserInputSchema,
  authzListManagedBindingsForUserOutputSchema,
  authzOwnStandingInputSchema,
  authzOwnStandingSchema,
  authzRevokeGrantByIdInputSchema,
  assignsCustomGrantRole,
  grantPageSchema,
  grantRevokedSchema,
  grantSchema,
  type AuthzPrincipalRef,
} from "@langwatch/authz-contract";
import { defineTrpcContract } from "@langwatch/kernel/contract";

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

  .query("listManagedGrants")
  .withInput(authzListManagedBindingsForOrganizationInputSchema)
  .withOutput(authzListManagedBindingsForOrganizationOutputSchema)

  .query("listMemberGrants")
  .withInput(authzListManagedBindingsForUserInputSchema)
  .withOutput(authzListManagedBindingsForUserOutputSchema)

  .mutation("applyMemberGrants")
  .withInput(authzApplyMemberBindingsInputSchema.omit(IMPLIED_BY_SESSION))
  .withOutput(authzBindingMutationSuccessSchema)
  .build();

/** The session as the escalation ceiling: a person, or the key a CLI session arrived on. */
function callerOf(actor: Actor): AuthzPrincipalRef {
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "apiKey", id: actor.id };

  return { type: "anonymous" };
}

/** Assigning a custom role is the Enterprise capability, refused on every plan below it. */
const customRoles = { feature: "RBAC", when: assignsCustomGrantRole };

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
    .withEntitlement("enterprise", customRoles)
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.createGrant({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    .procedure("changeGrantRole")
    .withEntitlement("enterprise", customRoles)
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.changeGrantRole({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    .procedure("revokeGrant")
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.revokeGrant({ ...input, actor: toLedgerActor(actor) }),
    )

    /** Every grant in the organization with its principal and scope named. */
    .procedure("listManagedGrants")
    .withPermission("organization:manage")
    .handle(async ({ app, input }) => app.listManagedBindingsForOrganization(input))

    /** One member's grants, cheaper than listing the organization and filtering. */
    .procedure("listMemberGrants")
    .withPermission("organization:manage")
    .handle(async ({ app, input }) => app.listManagedBindingsForUser(input))

    /** One member's revokes and creates together, so the sheet cannot half-apply. */
    .procedure("applyMemberGrants")
    .withEntitlement("enterprise", customRoles)
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.applyMemberBindings({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )
    .build();
