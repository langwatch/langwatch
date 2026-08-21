import { ledgerActorFor } from "@langwatch/actor";
import { declareAuthzMiddleware } from "@langwatch/authz";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Session } from "~/server/auth";
import { permissionFormatSchema } from "../../rbac/custom-role-permissions";
import { RoleService } from "../../role";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "../enterprise";
import { probeOrganizationPermission } from "~/server/app-layer/permissions/imperative";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const permissionSchema = permissionFormatSchema;

type RoleMiddlewareCtx = {
  prisma: PrismaClient;
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
      reason:
        "the role's organization is loaded by its id; the check runs there",
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
      const role = await new RoleService(ctx.prisma).getRoleById(input.roleId);
      if (
        !(await probeOrganizationPermission(ctx, role.organizationId, permission))
      ) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (enterprise) {
        await assertEnterprisePlan({
          organizationId: role.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }
      ctx.permissionChecked = true;
      return next();
    },
  );

export const roleRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    // Tightened from organization:view (which MEMBER has) to manage —
    // role definitions are an admin-surface read. All TS callers
    // (settings/roles, settings/teams, AddMembersForm, TeamUserRoleField,
    // GroupBindingInputRow) live in admin-context flows that already
    // require manage anyway, so the bump is invisible to legitimate UX
    // and closes a member-session direct-curl exfil path.
    .permission("organization:manage")
    .query(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return roleService.getAllRoles(input.organizationId);
    }),

  getById: protectedProcedure
    .input(z.object({ roleId: z.string() }))
    .use(roleOrganizationPermission({ permission: "organization:view" }))
    .query(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.getRoleById(input.roleId);
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(50),
        description: z.string().optional(),
        permissions: z.array(permissionSchema),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
      });

      const roleService = new RoleService(ctx.prisma);
      return await roleService.createRole({
        params: {
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        },
        actor: ledgerActorFor({
          userId: ctx.session.user.id,
          fallback: "managementApi",
        }),
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        roleId: z.string(),
        name: z.string().min(1).max(50).optional(),
        description: z.string().optional(),
        permissions: z.array(permissionSchema).optional(),
      }),
    )
    .use(
      roleOrganizationPermission({
        permission: "organization:manage",
        enterprise: true,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.updateRole({
        roleId: input.roleId,
        params: {
          name: input.name,
          description: input.description,
          permissions: input.permissions,
        },
        actor: ledgerActorFor({
          userId: ctx.session.user.id,
          fallback: "managementApi",
        }),
      });
    }),

  delete: protectedProcedure
    .input(z.object({ roleId: z.string() }))
    .use(roleOrganizationPermission({ permission: "organization:manage" }))
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.deleteRole({
        roleId: input.roleId,
        actor: ledgerActorFor({
          userId: ctx.session.user.id,
          fallback: "managementApi",
        }),
      });
    }),

  assignToUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        teamId: z.string(),
        customRoleId: z.string(),
      }),
    )
    .use(
      declareAuthzMiddleware(
        {
          kind: "custom",
          reason:
            "the team's organization is loaded by its id; the check runs there, before any plan detail is revealed",
          permissions: ["organization:manage"],
        },
        async ({
          ctx,
          input,
          next,
        }: {
          ctx: RoleMiddlewareCtx;
          input: { teamId: string };
          next: () => Promise<unknown>;
        }) => {
          const team = await ctx.prisma.team.findUnique({
            where: { id: input.teamId },
            select: { organizationId: true },
          });

          if (!team) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Team not found",
            });
          }

          if (
            !(await probeOrganizationPermission(
              ctx,
              team.organizationId,
              "organization:manage",
            ))
          ) {
            throw new TRPCError({ code: "UNAUTHORIZED" });
          }

          await assertEnterprisePlan({
            organizationId: team.organizationId,
            user: ctx.session.user,
            errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });

          ctx.permissionChecked = true;
          return next();
        },
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.assignRoleToUser({
        userId: input.userId,
        teamId: input.teamId,
        customRoleId: input.customRoleId,
        actor: ledgerActorFor({
          userId: ctx.session.user.id,
          fallback: "managementApi",
        }),
      });
    }),

  removeFromUser: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        teamId: z.string(),
        customRoleId: z.string(),
      }),
    )
    .permission("organization:manage", { via: "teamId" })
    .mutation(async ({ ctx, input }) => {
      const roleService = new RoleService(ctx.prisma);
      return await roleService.removeRoleFromUser({
        userId: input.userId,
        teamId: input.teamId,
        actor: ledgerActorFor({
          userId: ctx.session.user.id,
          fallback: "managementApi",
        }),
      });
    }),
});
