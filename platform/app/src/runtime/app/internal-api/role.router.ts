import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import { TeamNotFoundError } from "@langwatch/role-contract";
import { RoleTrpcApi, roleTrpcInputSchemas } from "@langwatch/role-server";
import { TRPCError } from "@trpc/server";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  requireEnterprisePlan,
} from "@langwatch/enterprise-plan-gate";
import { protectedProcedure } from "~/server/api/trpc.permission-builder";
import { appTrpcRoot } from "~/server/api/trpc.root";
import type { App } from "~/server/app-layer/app";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import type { Session } from "~/server/auth";
import { permissionFormatSchema } from "~/server/rbac/custom-role-permissions";

const inputs = roleTrpcInputSchemas({ customRolePermission: permissionFormatSchema });

type RoleMiddlewareCtx = {
  app?: Pick<App, "permissions" | "roles" | "planProvider">;
  session: Session;
  permissionChecked: boolean;
};

/**
 * The role's organization is data loaded by the role id, so the check runs
 * there — one declared middleware instead of four inline copies. The
 * permission check runs BEFORE any plan assertion so a denial never reveals
 * plan details.
 */
const roleOrganizationPermission = ({
  permission,
  enterprise = false,
}: {
  permission: "organization:view" | "organization:manage";
  enterprise?: boolean;
}) =>
  declareAuthzMiddleware(
    {
      kind: "custom",
      reason: "the role's organization is loaded by its id; the check runs there",
      permissions: [permission],
    },
    async ({
      ctx,
      input,
      next,
    }: {
      ctx: RoleMiddlewareCtx;
      input: { roleId: string };
      next: () => Promise<unknown>;
    }) => {
      const app = ctx.app;
      if (!app?.roles) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const role = await app.roles.getRole({ roleId: input.roleId });
      if (!(await probeOrganizationPermission(ctx, role.organizationId, permission))) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (enterprise) {
        await assertEnterprisePlan({
          planProvider: app.planProvider,
          organizationId: role.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }
      ctx.permissionChecked = true;
      return next();
    },
  );

/**
 * The plan gate for a team assignment. The permission middleware ahead of it
 * already resolved the team's organization for its own check; this reloads it
 * through the Role service because the plan is read per organization, and a
 * team nobody can name is a 404 rather than a plan refusal.
 */
const requireAssignmentEnterprisePlan = async ({
  ctx,
  input,
  next,
}: {
  ctx: { app: Pick<App, "roles" | "planProvider">; session: Session };
  input: { teamId: string };
  next: () => any;
}) => {
  let organizationId: string;
  try {
    organizationId = await ctx.app.roles.getAssignmentOrganization({ teamId: input.teamId });
  } catch (error) {
    if (error instanceof TeamNotFoundError) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
    }
    throw error;
  }
  await assertEnterprisePlan({
    planProvider: ctx.app.planProvider,
    organizationId,
    user: ctx.session.user,
    errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
  });
  return next();
};

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const roleRouter = RoleTrpcApi.create(appTrpcRoot, {
  getAll: protectedProcedure
    .input(inputs.getAll)
    // Tightened from organization:view (which MEMBER has) to manage —
    // role definitions are an admin-surface read. All TS callers
    // (settings/roles, settings/teams, AddMembersForm, TeamUserRoleField,
    // GroupBindingInputRow) live in admin-context flows that already
    // require manage anyway, so the bump is invisible to legitimate UX
    // and closes a member-session direct-curl exfil path.
    .permission("organization:manage"),

  getById: protectedProcedure
    .input(inputs.getById)
    .use(roleOrganizationPermission({ permission: "organization:view" })),

  create: protectedProcedure
    .input(inputs.create)
    .permission("organization:manage")
    .use(requireEnterprisePlan(ENTERPRISE_FEATURE_ERRORS.RBAC)),

  update: protectedProcedure
    .input(inputs.update)
    .use(
      roleOrganizationPermission({
        permission: "organization:manage",
        enterprise: true,
      }),
    ),

  delete: protectedProcedure
    .input(inputs.delete)
    .use(roleOrganizationPermission({ permission: "organization:manage" })),

  assignToUser: protectedProcedure
    .input(inputs.assignToUser)
    // The declared form of the check the old custom middleware hand-rolled:
    // resolve the team's organization from its id and require
    // organization:manage there. The permission runs before the plan gate,
    // so plan detail is never revealed to a caller who couldn't manage.
    .permission("organization:manage", { via: "teamId" })
    .use(requireAssignmentEnterprisePlan),

  removeFromUser: protectedProcedure
    .input(inputs.removeFromUser)
    .permission("organization:manage", { via: "teamId" }),
});
