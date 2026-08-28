import type { LedgerActor } from "@langwatch/actor";
import {
  type AuthzGrantsService,
  type AuthzService,
  roleBindingScopeTypeSchema,
  teamUserRoleSchema,
} from "@langwatch/authz-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { DeclaredProcedure } from "./role.api";

type RoleBindingApplication = Readonly<{
  permissions: AuthzService;
  authzGrants: AuthzGrantsService;
}>;

/** The process supplies authentication, authorization and audit policy. */
export type RoleBindingTrpcContext = Readonly<{
  app: RoleBindingApplication;
  actor(): Readonly<{ id: string }>;
  /** The signed-in member's own display identity, which the access breakdown
   *  labels their rows with. */
  session: Readonly<{
    user: Readonly<{ name?: string | null; email?: string | null }>;
  }> | null;
}>;

const bindingWriteSchema = z.object({
  role: teamUserRoleSchema,
  customRoleId: z.string().optional(),
  scopeType: roleBindingScopeTypeSchema,
  scopeId: z.string(),
});

/**
 * The wire contract of `roleBinding.*`, exactly as the browser sends it. The
 * process parses these on the procedures it builds, so the schemas stay owned
 * here while the access decision stays owned there.
 */
export function roleBindingTrpcInputSchemas() {
  return {
    listForOrg: z.object({ organizationId: z.string() }),
    listForUser: z.object({ organizationId: z.string(), userId: z.string() }),
    getMyAccessBreakdown: z.object({ organizationId: z.string() }),
    create: z.object({
      organizationId: z.string(),
      // Principal — exactly one
      userId: z.string().optional(),
      groupId: z.string().optional(),
      // Role
      role: teamUserRoleSchema,
      customRoleId: z.string().optional(),
      // Scope
      scopeType: roleBindingScopeTypeSchema,
      scopeId: z.string(),
    }),
    update: z.object({
      organizationId: z.string(),
      bindingId: z.string(),
      role: teamUserRoleSchema,
      customRoleId: z.string().optional(),
    }),
    delete: z.object({
      organizationId: z.string(),
      bindingId: z.string(),
    }),
    applyMemberBindings: z.object({
      organizationId: z.string(),
      userId: z.string(),
      bindingIdsToDelete: z.array(z.string()),
      bindingsToCreate: z.array(bindingWriteSchema),
    }),
  };
}

export type RoleBindingTrpcInputSchemas = ReturnType<typeof roleBindingTrpcInputSchemas>;

export type RoleBindingTrpcProcedures<TContext> = Readonly<{
  [Name in keyof RoleBindingTrpcInputSchemas]: DeclaredProcedure<
    TContext,
    RoleBindingTrpcInputSchemas[Name]
  >;
}>;

const ledgerActor = (userId: string): LedgerActor => ({
  type: "user",
  id: userId,
});

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
        return ctx.app.permissions.listManagedBindingsForOrganization({
          organizationId: input.organizationId,
        });
      }),

      /**
       * List role bindings for a specific user — used by the member detail dialog.
       * More efficient than listForOrg + client-side filter for large orgs.
       */
      listForUser: procedures.listForUser.query(async ({ ctx, input }) => {
        return ctx.app.permissions.listManagedBindingsForUser({
          organizationId: input.organizationId,
          userId: input.userId,
        });
      }),

      /**
       * Returns the current user's full RBAC breakdown:
       * org role, group memberships + their bindings, direct bindings, all with resolved permissions.
       */
      getMyAccessBreakdown: procedures.getMyAccessBreakdown.query(async ({ ctx, input }) => {
        return ctx.app.permissions.getAccessBreakdown({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
          userName: ctx.session?.user.name ?? null,
          userEmail: ctx.session?.user.email ?? null,
        });
      }),

      /**
       * Create a role binding (user or group) at a given scope.
       */
      create: procedures.create.mutation(async ({ ctx, input }) => {
        return ctx.app.authzGrants.createBinding({
          organizationId: input.organizationId,
          actor: ledgerActor(ctx.actor().id),
          userId: input.userId,
          groupId: input.groupId,
          role: input.role,
          customRoleId: input.customRoleId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        });
      }),

      /**
       * Update the role on an existing binding.
       */
      update: procedures.update.mutation(async ({ ctx, input }) => {
        return ctx.app.authzGrants.updateBinding({
          organizationId: input.organizationId,
          actor: ledgerActor(ctx.actor().id),
          bindingId: input.bindingId,
          role: input.role,
          customRoleId: input.customRoleId,
        });
      }),

      /**
       * Delete a role binding by id.
       */
      delete: procedures.delete.mutation(async ({ ctx, input }) => {
        return ctx.app.authzGrants.deleteBinding({
          organizationId: input.organizationId,
          actor: ledgerActor(ctx.actor().id),
          bindingId: input.bindingId,
        });
      }),

      /**
       * Atomically apply a batch of binding deletes + creates for a single user.
       * The MemberDetailDialog uses this so a partial failure cannot leave a user
       * with some bindings deleted but others not added.
       */
      applyMemberBindings: procedures.applyMemberBindings.mutation(async ({ ctx, input }) => {
        return ctx.app.authzGrants.applyMemberBindings({
          organizationId: input.organizationId,
          actor: ledgerActor(ctx.actor().id),
          userId: input.userId,
          bindingIdsToDelete: input.bindingIdsToDelete,
          bindingsToCreate: input.bindingsToCreate,
        });
      }),
    });
  }
}
