import { ledgerActorFor } from "@langwatch/actor";
import type { RoleService } from "@langwatch/role-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { ProcedureBuilder, UnsetMarker } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";

type RoleApplication = Readonly<{ roles: RoleService }>;

/** The process supplies authentication, authorization, plan and audit policy. */
export type RoleTrpcContext = Readonly<{
  app: RoleApplication;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * The permission vocabulary a custom role is written in. It spans every
 * feature, so the process owns it and hands it in — the role surface only
 * says that a permission is a validated string.
 */
export type CustomRolePermissionSchema = z.ZodType<string, string>;

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
    getAll: z.object({ organizationId: z.string() }),
    getById: z.object({ roleId: z.string() }),
    create: z.object({
      organizationId: z.string(),
      name: z.string().min(1).max(50),
      description: z.string().optional(),
      permissions: z.array(customRolePermission),
    }),
    update: z.object({
      roleId: z.string(),
      name: z.string().min(1).max(50).optional(),
      description: z.string().optional(),
      permissions: z.array(customRolePermission).optional(),
    }),
    delete: z.object({ roleId: z.string() }),
    assignToUser: z.object({
      userId: z.string(),
      teamId: z.string(),
      customRoleId: z.string(),
    }),
    removeFromUser: z.object({
      userId: z.string(),
      teamId: z.string(),
      customRoleId: z.string(),
    }),
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
        return ctx.app.roles.list({ organizationId: input.organizationId });
      }),

      getById: procedures.getById.query(async ({ ctx, input }) => {
        return await ctx.app.roles.get({ roleId: input.roleId });
      }),

      create: procedures.create.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.create({
          role: {
            organizationId: input.organizationId,
            name: input.name,
            description: input.description,
            permissions: input.permissions,
          },
          actor: ledgerActorFor({ userId: ctx.actor().id, fallback: "managementApi" }),
        });
      }),

      update: procedures.update.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.update({
          roleId: input.roleId,
          changes: {
            name: input.name,
            description: input.description,
            permissions: input.permissions,
          },
          actor: ledgerActorFor({ userId: ctx.actor().id, fallback: "managementApi" }),
        });
      }),

      delete: procedures.delete.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.remove({
          roleId: input.roleId,
          actor: ledgerActorFor({ userId: ctx.actor().id, fallback: "managementApi" }),
        });
      }),

      assignToUser: procedures.assignToUser.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.assignToUser({
          userId: input.userId,
          teamId: input.teamId,
          customRoleId: input.customRoleId,
          actor: ledgerActorFor({ userId: ctx.actor().id, fallback: "managementApi" }),
        });
      }),

      removeFromUser: procedures.removeFromUser.mutation(async ({ ctx, input }) => {
        return await ctx.app.roles.removeFromUser({
          userId: input.userId,
          teamId: input.teamId,
          actor: ledgerActorFor({ userId: ctx.actor().id, fallback: "managementApi" }),
        });
      }),
    });
  }
}
