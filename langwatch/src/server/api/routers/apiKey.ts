import type { PrismaClient } from "@prisma/client";
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { DomainError } from "~/server/app-layer/domain-error";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { auditLog } from "~/server/auditLog";
import { skipPermissionCheck } from "../rbac";

/**
 * Maps an API key domain error to a tRPCError. Re-throws anything
 * that isn't a handled DomainError.
 */
function mapApiKeyDomainError(error: unknown): never {
  if (DomainError.isHandled(error)) {
    switch (error.kind) {
      case "api_key_not_found":
        throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
      case "api_key_not_owned":
      case "api_key_permission_denied":
      case "api_key_scope_violation":
        throw new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
      case "api_key_already_revoked":
        throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
    }
  }
  throw error;
}

async function isOrgAdmin(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const binding = await prisma.roleBinding.findFirst({
    where: {
      userId,
      organizationId,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      role: TeamUserRole.ADMIN,
    },
  });
  return !!binding;
}

const roleBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  customRoleId: z.string().nullish(),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
});

export const apiKeyRouter = createTRPCRouter({
  /**
   * Returns the caller's own RoleBindings within the given organization.
   * Used by the Create/Edit drawers to mirror the user's permissions.
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

  /**
   * Lists API keys. Admins see all keys in the org; non-admins see only their own.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      skipPermissionCheck({
        allow: { organizationId: "listing API keys" },
      }),
    )
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      const callerIsAdmin = await isOrgAdmin(
        ctx.prisma,
        ctx.session.user.id,
        input.organizationId,
      );

      const apiKeys = callerIsAdmin
        ? await apiKeyService.listAll({ organizationId: input.organizationId })
        : await apiKeyService.list({
            userId: ctx.session.user.id,
            organizationId: input.organizationId,
          });

      // Resolve scope names and user names for display
      const allBindings = apiKeys.flatMap((k) => k.roleBindings);
      const orgIds = new Set<string>();
      const teamIds = new Set<string>();
      const projectIds = new Set<string>();
      const customRoleIds = new Set<string>();
      const userIds = new Set<string>();

      for (const b of allBindings) {
        if (b.scopeType === RoleBindingScopeType.ORGANIZATION)
          orgIds.add(b.scopeId);
        else if (b.scopeType === RoleBindingScopeType.TEAM)
          teamIds.add(b.scopeId);
        else if (b.scopeType === RoleBindingScopeType.PROJECT)
          projectIds.add(b.scopeId);
        if (b.customRoleId) customRoleIds.add(b.customRoleId);
      }
      for (const k of apiKeys) {
        if (k.userId) userIds.add(k.userId);
        if (k.createdByUserId) userIds.add(k.createdByUserId);
      }

      const [orgs, teams, projects, customRoles, users] = await Promise.all([
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
        userIds.size
          ? ctx.prisma.user.findMany({
              where: { id: { in: [...userIds] } },
              select: { id: true, name: true, email: true },
            })
          : Promise.resolve([]),
      ]);

      const orgName = new Map(orgs.map((o) => [o.id, o.name]));
      const teamName = new Map(teams.map((t) => [t.id, t.name]));
      const projectName = new Map(projects.map((p) => [p.id, p.name]));
      const customRoleName = new Map(customRoles.map((r) => [r.id, r.name]));
      const userName = new Map(users.map((u) => [u.id, u.name ?? u.email]));

      return apiKeys.map((apiKey) => ({
        id: apiKey.id,
        lookupIdSuffix: apiKey.lookupId.slice(-4),
        name: apiKey.name,
        description: apiKey.description,
        permissionMode: apiKey.permissionMode,
        userId: apiKey.userId,
        userName: apiKey.userId ? (userName.get(apiKey.userId) ?? null) : null,
        createdByUserId: apiKey.createdByUserId,
        createdByUserName: apiKey.createdByUserId
          ? userName.get(apiKey.createdByUserId) ?? null
          : null,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        roleBindings: apiKey.roleBindings.map((rb) => ({
          id: rb.id,
          role: rb.role,
          customRoleId: rb.customRoleId,
          customRoleName: rb.customRoleId
            ? customRoleName.get(rb.customRoleId) ?? null
            : null,
          scopeType: rb.scopeType,
          scopeId: rb.scopeId,
          scopeName:
            rb.scopeType === RoleBindingScopeType.ORGANIZATION
              ? orgName.get(rb.scopeId) ?? null
              : rb.scopeType === RoleBindingScopeType.TEAM
                ? teamName.get(rb.scopeId) ?? null
                : projectName.get(rb.scopeId) ?? null,
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
        permissionMode: z.enum(["all", "readonly", "restricted"]).default("all"),
        keyType: z.enum(["personal", "service"]).default("personal"),
        assignedToUserId: z.string().optional(),
        bindings: z.array(roleBindingSchema).max(20),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "creating API key for user's own org" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const isService = input.keyType === "service";

      // Service keys and assigning to another user both require admin
      if (isService || (input.assignedToUserId && input.assignedToUserId !== ctx.session.user.id)) {
        const callerIsAdmin = await isOrgAdmin(
          ctx.prisma,
          ctx.session.user.id,
          input.organizationId,
        );
        if (!callerIsAdmin) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: isService
              ? "Only organization admins can create service API keys"
              : "Only organization admins can create API keys for other users",
          });
        }
      }

      const targetUserId = isService ? null : (input.assignedToUserId ?? ctx.session.user.id);
      const createdByUserId = ctx.session.user.id;

      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        const { token, apiKey } = await apiKeyService.create({
          name: input.name,
          description: input.description,
          userId: targetUserId,
          createdByUserId,
          organizationId: input.organizationId,
          expiresAt: input.expiresAt,
          permissionMode: isService ? "all" : input.permissionMode,
          bindings: input.bindings,
        });

        void auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "apiKey.create",
          args: {
            apiKeyId: apiKey.id,
            name: input.name,
            keyType: input.keyType,
            permissionMode: isService ? "all" : input.permissionMode,
            assignedToUserId: targetUserId,
          },
        });

        return {
          token,
          apiKey: {
            id: apiKey.id,
            name: apiKey.name,
            createdAt: apiKey.createdAt,
          },
        };
      } catch (error) {
        mapApiKeyDomainError(error);
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        apiKeyId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).nullish(),
        permissionMode: z.enum(["all", "readonly", "restricted"]).optional(),
        bindings: z.array(roleBindingSchema).min(1).max(20).optional(),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "updating API key" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerIsAdmin = await isOrgAdmin(
        ctx.prisma,
        ctx.session.user.id,
        input.organizationId,
      );

      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        const updated = await apiKeyService.update({
          id: input.apiKeyId,
          callerUserId: ctx.session.user.id,
          callerIsAdmin,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          permissionMode: input.permissionMode,
          bindings: input.bindings,
        });

        void auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "apiKey.update",
          args: {
            apiKeyId: input.apiKeyId,
            name: input.name,
            permissionMode: input.permissionMode,
          },
        });

        return {
          id: updated.id,
          name: updated.name,
          permissionMode: updated.permissionMode,
        };
      } catch (error) {
        mapApiKeyDomainError(error);
      }
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        apiKeyId: z.string(),
      }),
    )
    .use(
      skipPermissionCheck({
        allow: { organizationId: "revoking API key" },
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const callerIsAdmin = await isOrgAdmin(
        ctx.prisma,
        ctx.session.user.id,
        input.organizationId,
      );

      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        await apiKeyService.revoke({
          id: input.apiKeyId,
          callerUserId: ctx.session.user.id,
          callerIsAdmin,
        });

        void auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "apiKey.revoke",
          args: { apiKeyId: input.apiKeyId },
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }
      return { success: true };
    }),

  /**
   * Returns all projects in the org for the restricted permissions picker.
   */
  orgProjects: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      skipPermissionCheck({
        allow: { organizationId: "listing org projects for permission picker" },
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.project.findMany({
        where: {
          team: { organizationId: input.organizationId },
          archivedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
    }),

  /**
   * Returns org members for the admin user picker (admin only).
   */
  orgMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(
      skipPermissionCheck({
        allow: { organizationId: "listing org members for key assignment" },
      }),
    )
    .query(async ({ ctx, input }) => {
      const callerIsAdmin = await isOrgAdmin(
        ctx.prisma,
        ctx.session.user.id,
        input.organizationId,
      );
      if (!callerIsAdmin) return [];

      const orgUsers = await ctx.prisma.organizationUser.findMany({
        where: { organizationId: input.organizationId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
      return orgUsers.map((ou) => ({
        id: ou.user.id,
        name: ou.user.name,
        email: ou.user.email,
      }));
    }),
});
