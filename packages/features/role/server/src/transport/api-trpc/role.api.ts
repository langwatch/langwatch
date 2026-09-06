/**
 * Custom role definitions over the process's tRPC transport.
 *
 *   getAll / getById: the organization's roles, and one of them.
 *   create / update / delete: the definitions themselves.
 *   assignToUser / removeFromUser: a role given on one team, and taken back.
 *
 * Role definition is a privilege-escalation surface — whoever writes a role
 * writes their own permissions — so four of the seven gates are NOT a
 * declaration this file can make: they name a ROLE rather than the
 * organization the check has to run against, and the organization is a row
 * loaded by that id. Those arrive already built, through {@link
 * RoleTrpcAccess}, and are declared here with the reason each one exists.
 *
 * Transport only: input parsing, the access declaration, and delegation to the
 * canonical Role service.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import {
  roleApiCreateInputSchema,
  roleApiOrganizationInputSchema,
  roleApiRoleInputSchema,
  roleApiUpdateInputSchema,
  roleApiUserRoleAssignmentInputSchema,
  roleSchema,
  roleWriteAcknowledgedSchema,
  type CustomRolePermissionSchema,
} from "@langwatch/role-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
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
 * The wire contract of `role.*`, exactly as the browser sends it. Exported
 * because the permission format a custom role's entries are parsed against is
 * the deployment's, so the schemas cannot be built without it.
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
 * The gates this file cannot declare, already built by the process.
 *
 * Each one is a check whose scope is DATA rather than input: the role's
 * organization, loaded by the role id, or the assignment team's. Two of them
 * also carry the plan gate, which runs after the permission so a denial never
 * reveals which plan the organization is on.
 */
export type RoleTrpcAccess = Readonly<{
  /** `organization:view` on the organization the named role belongs to. */
  viewRoleOrganization: TrpcPolicyDecorator;
  /** `organization:manage` on the organization the named role belongs to. */
  manageRoleOrganization: TrpcPolicyDecorator;
  /** The same, then the plan gate for editing a definition. */
  manageRoleOrganizationThenPlan: TrpcPolicyDecorator;
  /** `organization:manage` on the named organization, then the plan gate. */
  manageOrganizationThenPlan: TrpcPolicyDecorator;
  /** `organization:manage` via the assignment's team, then the plan gate. */
  manageAssignmentTeamThenPlan: TrpcPolicyDecorator;
}>;

export type RoleTrpcProcedures<
  TContext extends RoleTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration. The chain applies it AFTER this
   * feature's input parser, which is the ordering the authorization check
   * depends on: a check installed before `.input()` reads no scope id.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see {@link RoleTrpcAccess} */
  access: RoleTrpcAccess;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** What this transport needs that is neither the role's nor the process's gate. */
export type RoleTrpcPorts = Readonly<{
  /** The permission format a custom role's entries are parsed against. */
  customRolePermission: CustomRolePermissionSchema;
}>;

const ROLE_ORGANIZATION_IS_DATA =
  "the role's organization is loaded by its id, so the check runs there rather than on input";

const TEAM_ORGANIZATION_IS_DATA =
  "the assignment's organization is resolved from its team, and the plan is read there";

/** Installs the complete `role.*` tRPC surface on a process-owned root. */
export class RoleTrpcApi {
  static create<
    TContext extends RoleTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: RoleTrpcProcedures<TContext, TOptions, TRoot>,
    ports: RoleTrpcPorts,
  ) {
    const { protected: procedure, policy, access, validateOutput } = procedures;
    const inputs = roleTrpcInputSchemas({ customRolePermission: ports.customRolePermission });

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("getAll", (p) =>
        p
          .withInput(inputs.getAll)
          .withOutput(roleSchema.array())
          /**
           * Tightened from organization:view to manage: role definitions are an
           * admin-surface read, and every screen that lists them already
           * requires manage. The bump closes a member-session direct-call path
           * and is invisible to the product.
           */
          .withPermission("organization:manage")
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.listRoles({ organizationId: input.organizationId }),
          ),
      )
      .query("getById", (p) =>
        p
          .withInput(inputs.getById)
          .withOutput(roleSchema)
          .withCustomPermission(access.viewRoleOrganization, ROLE_ORGANIZATION_IS_DATA)
          .handle(async ({ ctx, input }) => ctx.app.roles.getRole({ roleId: input.roleId })),
      )
      .mutation("create", (p) =>
        p
          .withInput(inputs.create)
          .withOutput(roleSchema)
          .withCustomPermission(
            access.manageOrganizationThenPlan,
            "organization:manage on the named organization, then the plan gate that governs custom roles",
          )
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.createRole(
              {
                role: {
                  organizationId: input.organizationId,
                  name: input.name,
                  description: input.description,
                  permissions: input.permissions,
                },
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("update", (p) =>
        p
          .withInput(inputs.update)
          .withOutput(roleSchema)
          .withCustomPermission(access.manageRoleOrganizationThenPlan, ROLE_ORGANIZATION_IS_DATA)
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.updateRole(
              {
                roleId: input.roleId,
                changes: {
                  name: input.name,
                  description: input.description,
                  permissions: input.permissions,
                },
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("delete", (p) =>
        p
          .withInput(inputs.delete)
          .withOutput(roleWriteAcknowledgedSchema)
          .withCustomPermission(access.manageRoleOrganization, ROLE_ORGANIZATION_IS_DATA)
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.deleteRole({ roleId: input.roleId }, ctx.actor()),
          ),
      )
      .mutation("assignToUser", (p) =>
        p
          .withInput(inputs.assignToUser)
          .withOutput(roleWriteAcknowledgedSchema)
          .withCustomPermission(access.manageAssignmentTeamThenPlan, TEAM_ORGANIZATION_IS_DATA)
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.assignRoleToUser(
              {
                userId: input.userId,
                teamId: input.teamId,
                customRoleId: input.customRoleId,
              },
              ctx.actor(),
            ),
          ),
      )
      .mutation("removeFromUser", (p) =>
        p
          .withInput(inputs.removeFromUser)
          .withOutput(roleWriteAcknowledgedSchema)
          .withPermission({
            kind: "permission",
            permission: "organization:manage",
            via: "teamId",
          })
          .handle(async ({ ctx, input }) =>
            ctx.app.roles.removeRoleFromUser(
              { userId: input.userId, teamId: input.teamId },
              ctx.actor(),
            ),
          ),
      )
      .build();
  }
}
