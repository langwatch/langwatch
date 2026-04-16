import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PatService } from "~/server/pat/pat.service";
import { checkRoleBindingPermission } from "~/server/rbac/role-binding-resolver";
import { skipPermissionCheck, type Permission } from "../rbac";

const roleBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullish(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
});

export const personalAccessTokenRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      skipPermissionCheck({
        allow: { organizationId: "listing user's own PATs" },
      }),
    )
    .query(async ({ ctx, input }) => {
      const patService = PatService.create(ctx.prisma);
      const pats = await patService.list({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      return pats.map((pat) => ({
        id: pat.id,
        name: pat.name,
        createdAt: pat.createdAt,
        expiresAt: pat.expiresAt,
        lastUsedAt: pat.lastUsedAt,
        revokedAt: pat.revokedAt,
        roleBindings: pat.roleBindings.map((rb) => ({
          id: rb.id,
          role: rb.role,
          customRoleId: rb.customRoleId,
          scopeType: rb.scopeType,
          scopeId: rb.scopeId,
        })),
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(100),
        expiresAt: z.coerce.date().optional(),
        bindings: z.array(roleBindingSchema).min(1),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "creating PAT for user's own org" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate that the user is a member of this org
      const orgUser = await ctx.prisma.organizationUser.findFirst({
        where: {
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        },
      });
      if (!orgUser) {
        throw new Error("Not a member of this organization");
      }

      // Validate that requested bindings don't exceed the user's own permissions.
      for (const binding of input.bindings) {
        // Validate scope ownership: scopeId must belong to this organization
        if (binding.scopeType === RoleBindingScopeType.ORGANIZATION) {
          if (binding.scopeId !== input.organizationId) {
            throw new Error("Organization scope must match the PAT's organization");
          }
        } else if (binding.scopeType === RoleBindingScopeType.TEAM) {
          const team = await ctx.prisma.team.findFirst({
            where: { id: binding.scopeId, organizationId: input.organizationId },
            select: { id: true },
          });
          if (!team) {
            throw new Error(`Team ${binding.scopeId} not found in this organization`);
          }
        }

        const scope =
          binding.scopeType === RoleBindingScopeType.ORGANIZATION
            ? ({ type: "org" as const, id: binding.scopeId })
            : binding.scopeType === RoleBindingScopeType.TEAM
              ? ({ type: "team" as const, id: binding.scopeId })
              : await (async () => {
                  const project = await ctx.prisma.project.findUnique({
                    where: { id: binding.scopeId, archivedAt: null },
                    include: { team: { select: { id: true, organizationId: true } } },
                  });
                  if (!project) {
                    throw new Error(`Project ${binding.scopeId} not found or archived`);
                  }
                  if (project.team.organizationId !== input.organizationId) {
                    throw new Error(`Project ${binding.scopeId} does not belong to this organization`);
                  }
                  return { type: "project" as const, id: binding.scopeId, teamId: project.team.id };
                })();

        // For CUSTOM roles, load the custom role's permissions and verify the
        // user has every one of them — prevents privilege escalation via PAT.
        if (binding.role === TeamUserRole.CUSTOM) {
          if (!binding.customRoleId) {
            throw new Error("CUSTOM role requires a customRoleId");
          }
          const customRole = await ctx.prisma.customRole.findUnique({
            where: { id: binding.customRoleId, organizationId: input.organizationId },
            select: { permissions: true },
          });
          if (!customRole) {
            throw new Error(`Custom role ${binding.customRoleId} not found`);
          }
          const perms = Array.isArray(customRole.permissions)
            ? (customRole.permissions as string[])
            : [];
          for (const perm of perms) {
            const userHas = await checkRoleBindingPermission({
              prisma: ctx.prisma,
              principal: { type: "user", id: ctx.session.user.id },
              organizationId: input.organizationId,
              scope,
              permission: perm as Permission,
            });
            if (!userHas) {
              throw new Error(
                `Cannot grant permission "${perm}" — exceeds your own access`,
              );
            }
          }
        } else {
          // For built-in roles, check that the user has at least the same role's
          // highest permission at this scope (manage for ADMIN, create for MEMBER,
          // view for VIEWER).
          const representativePermission: Permission =
            binding.role === TeamUserRole.ADMIN
              ? "project:manage"
              : binding.role === TeamUserRole.MEMBER
                ? "project:create"
                : "project:view";

          const userHasPermission = await checkRoleBindingPermission({
            prisma: ctx.prisma,
            principal: { type: "user", id: ctx.session.user.id },
            organizationId: input.organizationId,
            scope,
            permission: representativePermission,
          });

          if (!userHasPermission) {
            throw new Error(
              `Cannot create PAT with ${binding.role} permissions — exceeds your own access at ${binding.scopeType}:${binding.scopeId}`,
            );
          }
        }
      }

      const patService = PatService.create(ctx.prisma);
      const { token, pat } = await patService.create({
        name: input.name,
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        expiresAt: input.expiresAt,
        bindings: input.bindings,
      });

      // Return token (shown once) plus metadata
      return {
        token,
        pat: {
          id: pat.id,
          name: pat.name,
          createdAt: pat.createdAt,
        },
      };
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        patId: z.string(),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "revoking user's own PAT" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patService = PatService.create(ctx.prisma);
      await patService.revoke({
        id: input.patId,
        userId: ctx.session.user.id,
      });
      return { success: true };
    }),
});
