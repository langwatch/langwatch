/**
 * Role definition is a privilege-escalation surface, so the process supplies
 * each procedure's access decision. A role-scoped CUSTOM check runs before
 * the plan gate.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import { declareAuthzMiddleware, type AuthzPermission } from "@langwatch/authz-contract";
import {
  RoleBindingTrpcApi,
  RoleTrpcApi,
  type RoleBindingTrpcContext,
  type RoleTrpcContext,
} from "@langwatch/role-server";
import { TRPCError } from "@trpc/server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { CustomRolePermissionSchema } from "@langwatch/role-contract";

/**
 * The two answers the role surface needs from the deployment: whether the
 * caller may administer an organization the INPUT never named, and whether that
 * organization's plan carries custom roles at all.
 */
export type RoleTrpcPorts = Readonly<{
  /** Whether the caller holds `permission` at this organization. */
  probeOrganizationPermission(
    ctx: RoleTrpcContext,
    organizationId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /**
   * Refuses an organization whose plan may not define or assign custom roles.
   * Throws; a refusal is never turned into a different answer here.
   */
  assertCustomRolePlan(
    ctx: RoleTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<void>;
  /** The permission format a custom role's entries are parsed against. */
  customRolePermission: CustomRolePermissionSchema;
}>;

/** The narrowest context the custom check below reads. */
type RoleCheckContext = RoleTrpcContext;

/**
 * One declared middleware rather than four inline copies. `declareAuthzMiddleware`
 * keeps it DECLARED so the sweep counts the claim where the enforcement is.
 */
function roleOrganizationCheck(
  ports: RoleTrpcPorts,
  options: { permission: "organization:view" | "organization:manage"; plan?: boolean },
) {
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason: "the role's organization is loaded by its id; the check runs there",
      permissions: [options.permission],
    },
    async ({
      ctx,
      input,
      next,
    }: {
      ctx: RoleCheckContext & { permissionChecked: boolean };
      input: { roleId: string };
      next: () => Promise<unknown>;
    }) => {
      const role = await ctx.app.roles.getRole({ roleId: input.roleId });
      if (
        !(await ports.probeOrganizationPermission(ctx, role.organizationId, options.permission))
      ) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (options.plan) {
        await ports.assertCustomRolePlan(ctx, { organizationId: role.organizationId });
      }
      ctx.permissionChecked = true;
      return next();
    },
  );
}

/**
 * The plan gate for a TEAM assignment. Reloads the organization through the
 * Role service rather than reusing the declared check's resolution, so an
 * unnamed team stays a not-found instead of a plan refusal.
 */
function assignmentPlanGate(ports: RoleTrpcPorts) {
  return async ({
    ctx,
    input,
    next,
  }: {
    ctx: RoleCheckContext;
    input: { teamId: string };
    next: () => Promise<unknown>;
  }) => {
    const organizationId = await ctx.app.roles.getAssignmentOrganization({ teamId: input.teamId });
    await ports.assertCustomRolePlan(ctx, { organizationId });
    return next();
  };
}

/** The `.use()` surface every tRPC procedure builder shares. */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

const withMiddleware = <TProcedure>(procedure: TProcedure, middleware: unknown): TProcedure =>
  (procedure as unknown as ChainableProcedure).use(middleware) as unknown as TProcedure;

/** Mounts `role.*` on the app process's tRPC root. */
export function createRoleTrpcRouter<
  TContext extends RoleTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<RoleTrpcPorts>) {
  const service = createTrpcApiService(mount);
  const custom = (options: {
    permission: "organization:view" | "organization:manage";
    plan?: boolean;
  }) => service.custom(roleOrganizationCheck(mount.ports, options));
  const manage = service.policy("organization:manage");
  const manageViaTeam = service.policy({
    kind: "permission",
    permission: "organization:manage",
    via: "teamId",
  });

  return RoleTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: service.policy,
      validateOutput: service.validateOutput,
      access: {
        viewRoleOrganization: custom({ permission: "organization:view" }),
        manageRoleOrganization: custom({ permission: "organization:manage" }),
        manageRoleOrganizationThenPlan: custom({ permission: "organization:manage", plan: true }),
        // The permission first, the plan second: a denial must never reveal
        // which plan the organization is on.
        manageOrganizationThenPlan: (procedure) =>
          withMiddleware(manage(procedure), planGateMiddleware(mount.ports)),
        // The declared form of the check the assignment used to hand-roll:
        // resolve the team's organization from its id, require manage there,
        // and only then consult the plan.
        manageAssignmentTeamThenPlan: (procedure) =>
          withMiddleware(manageViaTeam(procedure), assignmentPlanGate(mount.ports)),
      },
    },
    { customRolePermission: mount.ports.customRolePermission },
  );
}

/**
 * The plan gate for a role DEFINITION, where the organization is named by the
 * input the declared check already ran on.
 */
function planGateMiddleware(ports: RoleTrpcPorts) {
  return async ({
    ctx,
    input,
    next,
  }: {
    ctx: RoleCheckContext;
    input: { organizationId: string };
    next: () => Promise<unknown>;
  }) => {
    await ports.assertCustomRolePlan(ctx, { organizationId: input.organizationId });
    return next();
  };
}

/** Mounts `roleBinding.*` on the app process's tRPC root. */
export function createRoleBindingTrpcRouter<
  TContext extends RoleBindingTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot>) {
  const service = createTrpcApiService(mount);

  return RoleBindingTrpcApi.create(mount.root, {
    protected: service.protected,
    policy: service.policy,
    validateOutput: service.validateOutput,
  });
}
