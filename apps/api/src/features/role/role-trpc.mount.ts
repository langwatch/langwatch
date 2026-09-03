/**
 * App-process transport mounts for the role vertical: custom role definitions
 * and the bindings that hand them out.
 *
 * Behaviour is package-owned (`@langwatch/role-server`); this supplies the
 * process's root, its authenticated procedure and — procedure by procedure —
 * the access decision each one is guarded by. The package deliberately refuses
 * to assemble those itself: role definition is a privilege-escalation surface,
 * because whoever writes a role writes their own permissions, so the check that
 * guards each write is stated where the process's authorization lives.
 *
 * ## Why two checks rather than one
 *
 * Four of the seven `role.*` procedures name a ROLE rather than the
 * organization the check has to run against, and the role's organization is a
 * row loaded by that id. A declared `.permission()` reads its scope id from the
 * validated input and there is none to read, so those four carry a CUSTOM check
 * instead: it loads the role, probes the organization it belongs to, and only
 * then consults the plan. The permission runs BEFORE the plan gate so a denial
 * never reveals which plan the organization is on.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import { declareAuthzMiddleware, type AuthzPermission } from "@langwatch/authz-contract";
import {
  RoleBindingTrpcApi,
  RoleTrpcApi,
  roleBindingTrpcInputSchemas,
  roleTrpcInputSchemas,
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
 * The role's organization is data loaded by the role id, so the check runs
 * there — one declared middleware rather than four inline copies.
 *
 * `declareAuthzMiddleware` is what keeps it DECLARED: the sweep counts the
 * claim, and the claim is written where the enforcement is.
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
 * The plan gate for a TEAM assignment.
 *
 * The declared check ahead of it already resolved the team's organization for
 * its own decision; this reloads it through the Role service because the plan
 * is read per organization, and a team nobody can name stays a not-found rather
 * than becoming a plan refusal.
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
  const inputs = roleTrpcInputSchemas({ customRolePermission: mount.ports.customRolePermission });
  const custom = (options: {
    permission: "organization:view" | "organization:manage";
    plan?: boolean;
  }) => service.custom(roleOrganizationCheck(mount.ports, options));

  return RoleTrpcApi.create(mount.root, {
    // Tightened from organization:view to manage: role definitions are an
    // admin-surface read, and every screen that lists them already requires
    // manage. The bump closes a member-session direct-call path and is
    // invisible to the product.
    getAll: service.policy("organization:manage")(service.protected.input(inputs.getAll)),
    getById: custom({ permission: "organization:view" })(service.protected.input(inputs.getById)),
    create: withMiddleware(
      service.policy("organization:manage")(service.protected.input(inputs.create)),
      planGateMiddleware(mount.ports),
    ),
    update: custom({ permission: "organization:manage", plan: true })(
      service.protected.input(inputs.update),
    ),
    delete: custom({ permission: "organization:manage" })(service.protected.input(inputs.delete)),
    // The declared form of the check the assignment used to hand-roll: resolve
    // the team's organization from its id, require manage there, and only then
    // consult the plan.
    assignToUser: withMiddleware(
      service.policy("organization:manage")(service.protected.input(inputs.assignToUser)),
      assignmentPlanGate(mount.ports),
    ),
    removeFromUser: service.policy("organization:manage")(
      service.protected.input(inputs.removeFromUser),
    ),
  });
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
  const inputs = roleBindingTrpcInputSchemas();
  const manage = service.policy("organization:manage");

  return RoleBindingTrpcApi.create(mount.root, {
    // Audit-grade RBAC data — every binding's users, groups, scopes and role
    // assignments — so it stays at organization:manage rather than view.
    listForOrg: manage(service.protected.input(inputs.listForOrg)),
    listForUser: manage(service.protected.input(inputs.listForUser)),
    getMyAccessBreakdown: service.policy("organization:view")(
      service.protected.input(inputs.getMyAccessBreakdown),
    ),
    create: manage(service.protected.input(inputs.create)),
    update: manage(service.protected.input(inputs.update)),
    delete: manage(service.protected.input(inputs.delete)),
    applyMemberBindings: manage(service.protected.input(inputs.applyMemberBindings)),
  });
}
