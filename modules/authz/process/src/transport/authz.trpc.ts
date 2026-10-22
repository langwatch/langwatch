import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
// Frontend query for caller's permissions; declared here to avoid package cycle.
import type { Actor } from "@langwatch/authorization";
import { toLedgerActor } from "@langwatch/authorization";
import {
  AuthzApi,
  authzApplyMemberBindingsInputSchema,
  authzBraidRemovedSchema,
  authzBraidSchema,
  authzChangeBraidInputSchema,
  authzBraidTargetsSchema,
  authzCountProjectMembersHoldingInputSchema,
  authzListBraidTargetsInputSchema,
  authzCreateBraidInputSchema,
  authzListBraidsInputSchema,
  authzProjectMembersHoldingSchema,
  authzOrganizationBraidsSchema,
  authzOrganizationInputSchema,
  authzOrganizationPolicySchema,
  authzSetBraidsPolicyInputSchema,
  authzProjectBraidsSchema,
  authzRemoveBraidInputSchema,
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
import { defineTrpcContract } from "@langwatch/module";

/** Whose permissions bound a grant is the session's, so the input never names it. */
const IMPLIED_BY_SESSION = { caller: true, actor: true } as const;

export const authzTrpc = defineTrpcContract("authz")
  .query("effectivePermissions")
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
  .withInput(authzRevokeGrantByIdInputSchema.omit(IMPLIED_BY_SESSION))
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

  .query("listBraids")
  .withInput(authzListBraidsInputSchema)
  .withOutput(authzProjectBraidsSchema)

  .mutation("createBraid")
  .withInput(authzCreateBraidInputSchema.omit(IMPLIED_BY_SESSION))
  .withOutput(authzBraidSchema)

  .mutation("changeBraid")
  .withInput(authzChangeBraidInputSchema.omit(IMPLIED_BY_SESSION))
  .withOutput(authzBraidSchema)

  .mutation("removeBraid")
  .withInput(authzRemoveBraidInputSchema.omit(IMPLIED_BY_SESSION))
  .withOutput(authzBraidRemovedSchema)

  .query("getBraidsPolicy")
  .withInput(authzOrganizationInputSchema)
  .withOutput(authzOrganizationPolicySchema)

  .mutation("setBraidsPolicy")
  .withInput(authzSetBraidsPolicyInputSchema.omit({ actor: true }))
  .withOutput(authzOrganizationPolicySchema)

  .query("listOrganizationBraids")
  .withInput(authzOrganizationInputSchema)
  .withOutput(authzOrganizationBraidsSchema)

  .query("countProjectTraceViewers")
  .withInput(authzCountProjectMembersHoldingInputSchema.pick({ projectId: true }))
  .withOutput(authzProjectMembersHoldingSchema)

  .query("listBraidTargets")
  .withInput(authzListBraidTargetsInputSchema.omit({ caller: true }))
  .withOutput(authzBraidTargetsSchema)
  .build();

/** The session as the escalation ceiling: a person, or the key a CLI session arrived on. */
function callerOf(actor: Actor): AuthzPrincipalRef {
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "apiKey", id: actor.id };

  return { type: "anonymous" };
}

/** Assigning a custom role is the Enterprise capability, refused on every plan below it. */
const customRoles = { feature: "RBAC", when: assignsCustomGrantRole };

/** ADR-183 §9: every braid write is Enterprise; the list stays open so paused braids show. */
const braids = { feature: "BRAIDS" };
/** ADR-183 §2: nobody braids into a project whose traces they cannot read. */
const AT_READER = { via: "projectId", field: "readerProjectId" } as const;

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
      app.revokeGrant({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
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

    /** Members of either project list the braids touching it (ADR-183 §2). */
    .procedure("listBraids")
    .withPermission("project:view", { via: "projectId" })
    .handle(async ({ app, input }) => app.listBraids(input))

    /** The owner is the first target: braids:manage there, traces:view at the reader. */
    .procedure("createBraid")
    .withEntitlement("enterprise", braids)
    .withPermission("braids:manage", { via: "projectId" })
    .withPermission("traces:view", AT_READER)
    .handle(async ({ app, input, actor }) =>
      app.createBraid({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    .procedure("changeBraid")
    .withEntitlement("enterprise", braids)
    .withPermission("braids:manage", { via: "projectId" })
    .withPermission("traces:view", AT_READER)
    .handle(async ({ app, input, actor }) =>
      app.changeBraid({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    /** Either side's admins, on any plan: stopping a share only narrows access (coordinator). */
    .procedure("removeBraid")
    .withPermission("braids:manage", { via: "projectId" })
    .handle(async ({ app, input, actor }) =>
      app.removeBraid({ ...input, caller: callerOf(actor), actor: toLedgerActor(actor) }),
    )

    /** Any member reads whether project admins may braid (ADR-183 §2). */
    .procedure("getBraidsPolicy")
    .withPermission("organization:view")
    .handle(async ({ app, input }) => app.getOrganizationPolicy(input))

    /** Keeping braids to organisation admins is theirs alone, and Enterprise. */
    .procedure("setBraidsPolicy")
    .withEntitlement("enterprise", braids)
    .withPermission("organization:manage")
    .handle(async ({ app, input, actor }) =>
      app.setBraidsPolicy({ ...input, actor: toLedgerActor(actor) }),
    )

    /** The organisation's Braids screen: every live braid, for its admins on any plan. */
    .procedure("listOrganizationBraids")
    .withPermission("organization:manage")
    .handle(async ({ app, input }) => app.listOrganizationBraids(input))

    /** ADR-183 §7: the braid dialog's "<n> people in <reader> will see these spans". */
    .procedure("countProjectTraceViewers")
    .withPermission("traces:view", { via: "projectId" })
    .handle(async ({ app, input }) =>
      app.countProjectMembersHolding({ ...input, permission: "traces:view" }),
    )

    /** ADR-183 §2: the braid dialog's picker, decided for the viewer in one batch. */
    .procedure("listBraidTargets")
    .withPermission("braids:manage", { via: "projectId" })
    .handle(async ({ app, input, actor }) =>
      app.listBraidTargets({ ...input, caller: callerOf(actor) }),
    )
    .build();
