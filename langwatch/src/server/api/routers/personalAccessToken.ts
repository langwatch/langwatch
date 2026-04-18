import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { DomainError } from "~/server/app-layer/domain-error";
import { PatService } from "~/server/pat/pat.service";
import { checkRoleBindingPermission } from "~/server/rbac/role-binding-resolver";
import { skipPermissionCheck, type Permission } from "../rbac";

/**
 * Maps a PAT domain error (identified by `kind` — not `instanceof`, which
 * breaks across bundler module boundaries) to a tRPCError. Re-throws anything
 * that isn't a handled DomainError.
 */
function mapPatDomainError(error: unknown): never {
  if (DomainError.isHandled(error)) {
    switch (error.kind) {
      case "pat_not_found":
        throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
      case "pat_not_owned":
      case "pat_permission_denied":
      case "pat_scope_violation":
        throw new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
      case "pat_already_revoked":
        throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
    }
  }
  throw error;
}

const roleBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullish(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
});

export const personalAccessTokenRouter = createTRPCRouter({
  /**
   * Returns the caller's own RoleBindings within the given organization.
   * Used by the Create PAT drawer to default-mirror the user's permissions
   * onto the new PAT (the server still re-validates the ceiling on create).
   */
  myBindings: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      skipPermissionCheck({
        allow: { organizationId: "listing caller's own role bindings" },
      }),
    )
    .query(async ({ ctx, input }) => {
      const bindings = await ctx.prisma.roleBinding.findMany({
        where: {
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          role: true,
          customRoleId: true,
          scopeType: true,
          scopeId: true,
        },
      });

      // Resolve human-readable names for the scopes + custom roles referenced
      // by the bindings so the Create PAT drawer can display them directly
      // (e.g., "ADMIN — Team: Platform" instead of a raw UUID).
      const orgIds = new Set<string>();
      const teamIds = new Set<string>();
      const projectIds = new Set<string>();
      const customRoleIds = new Set<string>();
      for (const b of bindings) {
        if (b.scopeType === RoleBindingScopeType.ORGANIZATION)
          orgIds.add(b.scopeId);
        else if (b.scopeType === RoleBindingScopeType.TEAM)
          teamIds.add(b.scopeId);
        else if (b.scopeType === RoleBindingScopeType.PROJECT)
          projectIds.add(b.scopeId);
        if (b.customRoleId) customRoleIds.add(b.customRoleId);
      }

      const [orgs, teams, projects, customRoles] = await Promise.all([
        orgIds.size
          ? ctx.prisma.organization.findMany({
              where: { id: { in: [...orgIds] } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        teamIds.size
          ? ctx.prisma.team.findMany({
              where: { id: { in: [...teamIds] } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        projectIds.size
          ? ctx.prisma.project.findMany({
              where: { id: { in: [...projectIds] } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        customRoleIds.size
          ? ctx.prisma.customRole.findMany({
              where: { id: { in: [...customRoleIds] } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      const orgName = new Map(orgs.map((o) => [o.id, o.name]));
      const teamName = new Map(teams.map((t) => [t.id, t.name]));
      const projectName = new Map(projects.map((p) => [p.id, p.name]));
      const customRoleName = new Map(customRoles.map((r) => [r.id, r.name]));

      return bindings.map((b) => ({
        ...b,
        scopeName:
          b.scopeType === RoleBindingScopeType.ORGANIZATION
            ? orgName.get(b.scopeId) ?? null
            : b.scopeType === RoleBindingScopeType.TEAM
              ? teamName.get(b.scopeId) ?? null
              : projectName.get(b.scopeId) ?? null,
        customRoleName: b.customRoleId
          ? customRoleName.get(b.customRoleId) ?? null
          : null,
      }));
    }),

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
        description: pat.description,
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
        description: z.string().max(500).optional(),
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
        description: input.description,
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
      try {
        await patService.revoke({
          id: input.patId,
          userId: ctx.session.user.id,
        });
      } catch (error) {
        mapPatDomainError(error);
      }
      return { success: true };
    }),
});
