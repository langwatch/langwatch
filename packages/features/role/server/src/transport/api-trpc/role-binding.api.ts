/**
 * Role bindings over the process's tRPC transport: who holds a role, and
 * where. Every read here is audit-grade RBAC data, so the whole surface sits
 * at `organization:manage` apart from the caller's own breakdown, which is
 * their own standing and asks only for `organization:view`.
 *
 * Transport only: input parsing, the access declaration and delegation to the
 * {@link RoleApp} the definitions surface calls.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import {
  authzAccessBreakdownOutputSchema,
  authzBindingMutationSuccessSchema,
  authzCreateBindingOutputSchema,
  authzListManagedBindingsForOrganizationOutputSchema,
  authzListManagedBindingsForUserOutputSchema,
} from "@langwatch/authz-contract";
import {
  roleBindingApiApplyMemberBindingsInputSchema,
  roleBindingApiBindingInputSchema,
  roleBindingApiCreateInputSchema,
  roleBindingApiOrganizationInputSchema,
  roleBindingApiUpdateInputSchema,
  roleBindingApiUserInputSchema,
} from "@langwatch/role-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { RoleApp } from "#app/role.app";

/**
 * The process supplies authentication, authorization and audit policy.
 *
 * `app` is the slice of the process's application this feature reaches.
 * Bindings are the role feature answering — who holds a role, and where — so
 * they arrive through the same {@link RoleApp} the definitions surface calls,
 * under the same `roles` key the process bag already uses.
 */
export type RoleBindingTrpcContext = Readonly<{
  app: Readonly<{ roles: RoleApp }>;
  actor(): Readonly<{ id: string }>;
  /** The signed-in member's own display identity, which the access breakdown
   *  labels their rows with. */
  session: Readonly<{
    user: Readonly<{ name?: string | null; email?: string | null }>;
  }> | null;
}>;

/** The wire contract of `roleBinding.*`, exactly as the browser sends it. */
export function roleBindingTrpcInputSchemas() {
  return {
    listForOrg: roleBindingApiOrganizationInputSchema,
    listForUser: roleBindingApiUserInputSchema,
    getMyAccessBreakdown: roleBindingApiOrganizationInputSchema,
    create: roleBindingApiCreateInputSchema,
    update: roleBindingApiUpdateInputSchema,
    delete: roleBindingApiBindingInputSchema,
    applyMemberBindings: roleBindingApiApplyMemberBindingsInputSchema,
  };
}

export type RoleBindingTrpcInputSchemas = ReturnType<typeof roleBindingTrpcInputSchemas>;

export type RoleBindingTrpcProcedures<
  TContext extends RoleBindingTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration. The chain applies it AFTER this
   * feature's input parser, which is the ordering the check depends on.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/**
 * Installs the complete legacy `roleBinding.*` tRPC surface on a process-owned
 * root. Every procedure arrives with its access decision already declared, so
 * this adapter is the handler layer only.
 */
export class RoleBindingTrpcApi {
  static create<
    TContext extends RoleBindingTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: RoleBindingTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;
    const inputs = roleBindingTrpcInputSchemas();

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("listForOrg", (p) =>
        p
          .withInput(inputs.listForOrg)
          .withOutput(authzListManagedBindingsForOrganizationOutputSchema)
          /**
           * Audit-grade RBAC data — every binding's userIds, group memberships,
           * scope ids and names, role assignments — so it stays at
           * `organization:manage` rather than view. The members page renders an
           * Access column from this payload, so the column itself is hidden from
           * non-managers too.
           */
          .withPermission("organization:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.listBindingsForOrganization({ organizationId: input.organizationId }),
          ),
      )
      .query("listForUser", (p) =>
        p
          .withInput(inputs.listForUser)
          .withOutput(authzListManagedBindingsForUserOutputSchema)
          .withPermission("organization:manage")
          /**
           * The bindings of one member, for the member detail dialog. Cheaper
           * than listForOrg plus a client-side filter on a large organization.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.listBindingsForUser({
              organizationId: input.organizationId,
              userId: input.userId,
            }),
          ),
      )
      .query("getMyAccessBreakdown", (p) =>
        p
          .withInput(inputs.getMyAccessBreakdown)
          .withOutput(authzAccessBreakdownOutputSchema)
          /**
           * The caller's OWN standing, so `organization:view` is the whole
           * requirement: organization role, group memberships and their
           * bindings, direct bindings, each with the permissions it resolves to.
           */
          .withPermission("organization:view")
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.getCallerAccessBreakdown(
              {
                organizationId: input.organizationId,
                userName: ctx.session?.user.name ?? null,
                userEmail: ctx.session?.user.email ?? null,
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(inputs.create)
          .withOutput(authzCreateBindingOutputSchema)
          .withPermission("organization:manage")
          /** Binds a user or a group to a role at one scope. */
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.createBinding(
              {
                organizationId: input.organizationId,
                userId: input.userId,
                groupId: input.groupId,
                role: input.role,
                customRoleId: input.customRoleId,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("update", (p) =>
        p
          .withInput(inputs.update)
          .withOutput(authzCreateBindingOutputSchema)
          .withPermission("organization:manage")
          /** Rewrites the role on an existing binding. */
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.updateBinding(
              {
                organizationId: input.organizationId,
                bindingId: input.bindingId,
                role: input.role,
                customRoleId: input.customRoleId,
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("delete", (p) =>
        p
          .withInput(inputs.delete)
          .withOutput(authzBindingMutationSuccessSchema)
          .withPermission("organization:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.deleteBinding(
              { organizationId: input.organizationId, bindingId: input.bindingId },
              ctx.actor(),
            ),
          ),
      )
      .mutation("applyMemberBindings", (p) =>
        p
          .withInput(inputs.applyMemberBindings)
          .withOutput(authzBindingMutationSuccessSchema)
          .withPermission("organization:manage")
          /**
           * One member's deletes and creates applied atomically, so a partial
           * failure cannot leave somebody with bindings removed and none added.
           */
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.applyMemberBindings(
              {
                organizationId: input.organizationId,
                userId: input.userId,
                bindingIdsToDelete: input.bindingIdsToDelete,
                bindingsToCreate: input.bindingsToCreate,
              },
              ctx.actor(),
            ),
          ),
      )
      .build();
  }
}
