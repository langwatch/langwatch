import {
  roleApiCreateInputSchema,
  roleApiOrganizationInputSchema,
  roleApiRoleInputSchema,
  roleApiUpdateInputSchema,
  roleApiUserRoleAssignmentInputSchema,
  type CustomRolePermissionSchema,
} from "@langwatch/role-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { ProcedureBuilder, UnsetMarker } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";
import type { RoleApp } from "#app/role.app";

/**
 * The process supplies authentication, authorization, plan and audit policy.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type RoleTrpcContext = Readonly<{
  app: Readonly<{ roles: RoleApp }>;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * The wire contract of `role.*`, exactly as the browser sends it. The process
 * parses these on the procedures it builds, so the schemas stay owned here
 * while the access decision stays owned there.
 */
export function roleTrpcInputSchemas({
  customRolePermission,
}: {
  customRolePermission: CustomRolePermissionSchema;
}) {
  return {
    getAll: roleApiOrganizationInputSchema,
    getById: roleApiRoleInputSchema,
    create: roleApiCreateInputSchema(customRolePermission),
    update: roleApiUpdateInputSchema(customRolePermission),
    delete: roleApiRoleInputSchema,
    assignToUser: roleApiUserRoleAssignmentInputSchema,
    removeFromUser: roleApiUserRoleAssignmentInputSchema,
  };
}

export type RoleTrpcInputSchemas = ReturnType<typeof roleTrpcInputSchemas>;

/**
 * A procedure the process has already built: authenticated, input-parsed, and
 * carrying the declared access decision its chain enforces. Role definition is
 * a privilege-escalation surface — whoever writes roles writes their own
 * permissions — so the check that guards each procedure is never assembled
 * here, only the handler that runs once it passed.
 */
export type DeclaredProcedure<TContext, TSchema extends z.ZodType> = ProcedureBuilder<
  TContext,
  object,
  object,
  z.input<TSchema>,
  z.output<TSchema>,
  UnsetMarker,
  UnsetMarker,
  false
>;

export type RoleTrpcProcedures<TContext> = Readonly<{
  [Name in keyof RoleTrpcInputSchemas]: DeclaredProcedure<TContext, RoleTrpcInputSchemas[Name]>;
}>;

/**
 * Installs the complete legacy `role.*` tRPC surface on a process-owned root.
 * Every procedure arrives with its access decision already declared, so this
 * adapter is the handler layer only: it names the operations, shapes their
 * inputs, and delegates each one to the canonical Role service.
 */
export class RoleTrpcApi {
  static create<
    TContext extends RoleTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: RoleTrpcProcedures<TContext>,
  ) {
    return trpc.router({
      getAll: procedures.getAll.query(async ({ ctx, input }) => {
        return ctx.app.roles.listRoles({ organizationId: input.organizationId });
      }),

      getById: procedures.getById.query(async ({ ctx, input }) => {
        return await ctx.app.roles.getRole({ roleId: input.roleId });
      }),

      create: procedures.create.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.createRole(
          {
            role: {
              organizationId: input.organizationId,
              name: input.name,
              description: input.description,
              permissions: input.permissions,
            },
          },
          ctx.actor(),
        );
      }),

      update: procedures.update.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.updateRole(
          {
            roleId: input.roleId,
            changes: {
              name: input.name,
              description: input.description,
              permissions: input.permissions,
            },
          },
          ctx.actor(),
        );
      }),

      delete: procedures.delete.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.deleteRole({ roleId: input.roleId }, ctx.actor());
      }),

      assignToUser: procedures.assignToUser.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.assignRoleToUser(
          {
            userId: input.userId,
            teamId: input.teamId,
            customRoleId: input.customRoleId,
          },
          ctx.actor(),
        );
      }),

      removeFromUser: procedures.removeFromUser.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.removeRoleFromUser(
          { userId: input.userId, teamId: input.teamId },
          ctx.actor(),
        );
      }),
    });
  }
}
