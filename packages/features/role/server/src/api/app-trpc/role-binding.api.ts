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
import type { DeclaredProcedure } from "./role.api";

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

/**
 * The wire contract of `roleBinding.*`, exactly as the browser sends it. The
 * process parses these on the procedures it builds, so the schemas stay owned
 * here while the access decision stays owned there.
 */
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

export type RoleBindingTrpcProcedures<TContext> = Readonly<{
  [Name in keyof RoleBindingTrpcInputSchemas]: DeclaredProcedure<
    TContext,
    RoleBindingTrpcInputSchemas[Name]
  >;
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
    procedures: RoleBindingTrpcProcedures<TContext>,
  ) {
    return trpc.router({
      /**
       * List all role bindings in an org. Returns audit-grade RBAC data
       * (every binding's userIds, group memberships, scope ids/names, role
       * assignments) so it must stay gated at organization:manage. The members
       * page renders an Access column from this payload, so the column itself
       * must also be hidden from non-managers.
       */
      listForOrg: procedures.listForOrg.query(async ({ ctx, input }) => {
        return ctx.app.roles.listBindingsForOrganization({
          organizationId: input.organizationId,
        });
      }),

      /**
       * List role bindings for a specific user — used by the member detail dialog.
       * More efficient than listForOrg + client-side filter for large orgs.
       */
      listForUser: procedures.listForUser.query(async ({ ctx, input }) => {
        return ctx.app.roles.listBindingsForUser({
          organizationId: input.organizationId,
          userId: input.userId,
        });
      }),

      /**
       * Returns the current user's full RBAC breakdown:
       * org role, group memberships + their bindings, direct bindings, all with resolved permissions.
       */
      getMyAccessBreakdown: procedures.getMyAccessBreakdown.query(async ({ ctx, input }) => {
        return ctx.app.roles.getCallerAccessBreakdown(
          {
            organizationId: input.organizationId,
            userName: ctx.session?.user.name ?? null,
            userEmail: ctx.session?.user.email ?? null,
          },
          ctx.actor(),
        );
      }),

      /**
       * Create a role binding (user or group) at a given scope.
       */
      create: procedures.create.mutation(async ({ ctx, input }) => {
        return ctx.app.roles.createBinding(
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
        );
      }),

      /**
       * Update the role on an existing binding.
       */
      update: procedures.update.mutation(async ({ ctx, input }) => {
        return ctx.app.roles.updateBinding(
          {
            organizationId: input.organizationId,
            bindingId: input.bindingId,
            role: input.role,
            customRoleId: input.customRoleId,
          },
          ctx.actor(),
        );
      }),

      /**
       * Delete a role binding by id.
       */
      delete: procedures.delete.mutation(async ({ ctx, input }) => {
        return ctx.app.roles.deleteBinding(
          { organizationId: input.organizationId, bindingId: input.bindingId },
          ctx.actor(),
        );
      }),

      /**
       * Atomically apply a batch of binding deletes + creates for a single user.
       * The MemberDetailDialog uses this so a partial failure cannot leave a user
       * with some bindings deleted but others not added.
       */
      applyMemberBindings: procedures.applyMemberBindings.mutation(async ({ ctx, input }) => {
        return ctx.app.roles.applyMemberBindings(
          {
            organizationId: input.organizationId,
            userId: input.userId,
            bindingIdsToDelete: input.bindingIdsToDelete,
            bindingsToCreate: input.bindingsToCreate,
          },
          ctx.actor(),
        );
      }),
    });
  }
}
