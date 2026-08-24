import { auditLog } from "~/runtime/app/features/audit-log";
import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  API_KEY_PERMISSION_MODES,
  refineRestrictedPermissions,
} from "~/server/api-key/restricted-permissions";
import { permissionFormatSchema } from "~/server/rbac/custom-role-permissions";

function mapApiKeyHandledError(error: unknown): never {
  if (HandledError.isHandled(error)) {
    switch (error.code) {
      case "api_key_not_found":
        throw new TRPCError({
          code: "NOT_FOUND",
          message: error.message,
          cause: error,
        });
      case "api_key_not_owned":
      case "api_key_permission_denied":
      case "api_key_scope_violation":
        throw new TRPCError({
          code: "FORBIDDEN",
          message: error.message,
          cause: error,
        });
      case "api_key_already_revoked":
        throw new TRPCError({
          code: "CONFLICT",
          message: error.message,
          cause: error,
        });
      case "api_key_reserved_name":
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error.message,
          cause: error,
        });
      default:
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
          cause: error,
        });
    }
  }
  throw error;
}

async function ensureCallerIsOrgMember(
  service: ApiKeyService,
  userId: string,
  organizationId: string,
): Promise<void> {
  try {
    await service.ensureCallerIsOrgMember({ userId, organizationId });
  } catch (error) {
    mapApiKeyHandledError(error);
  }
}

const roleBindingSchema = z.object({
  role: z.nativeEnum(TeamUserRole),
  scopeType: z.nativeEnum(RoleBindingScopeType),
  scopeId: z.string(),
});

// RBAC is intentionally bypassed via .noPermission() on all endpoints.
// Authorization is handled at the service layer: ensureCallerIsOrgMember + isOrgAdmin.
export const apiKeyRouter = createTRPCRouter({
  /**
   * Returns the caller's own RoleBindings within the given organization.
   * Used by the Create/Edit drawers to mirror the user's permissions.
   */
  myBindings: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "listing caller's own role bindings" },
    })
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      const bindings = await apiKeyService.getUserBindings({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      const {
        orgName,
        teamName,
        activeProjectIds,
        projectName,
        customRoleName,
      } = await apiKeyService.enrichBindingsWithNames({ bindings });

      return bindings
        .filter(
          (b) =>
            b.scopeType !== RoleBindingScopeType.PROJECT ||
            activeProjectIds.has(b.scopeId),
        )
        .map((b) => ({
          ...b,
          scopeName:
            b.scopeType === RoleBindingScopeType.ORGANIZATION
              ? (orgName.get(b.scopeId) ?? null)
              : b.scopeType === RoleBindingScopeType.TEAM
                ? (teamName.get(b.scopeId) ?? null)
                : (projectName.get(b.scopeId) ?? null),
          customRoleName: b.customRoleId
            ? (customRoleName.get(b.customRoleId) ?? null)
            : null,
        }));
    }),

  /**
   * Resolve a single API key id to its display name.
   *
   * Deliberately narrower than {@link list}, which is admin-gated for the full
   * org and would otherwise show most of the team a raw row id wherever a key
   * is referenced. This answers one question, for one id the caller already
   * has, and returns nothing else: no lookup id, no secret, no owner, no
   * bindings, no list. Any member of the organization may ask, because anyone
   * who can already read a trace can already see the id stamped on it, and a
   * name is less revealing than the id.
   *
   * Not an enumeration surface: it takes a whole id rather than a prefix or a
   * filter, answers one at a time, and returns null identically for an id that
   * does not exist and one that belongs to another organization.
   */
  nameById: protectedProcedure
    .input(z.object({ organizationId: z.string(), apiKeyId: z.string() }))
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: {
        organizationId: "naming an API key the caller can already see",
      },
    })
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      return apiKeyService.getNameByIdInOrg({
        id: input.apiKeyId,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Lists API keys. Admins see all keys in the org; non-admins see only their own.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "listing API keys" },
    })
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      const callerIsAdmin = await apiKeyService.isOrgAdmin({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      const apiKeys = callerIsAdmin
        ? await apiKeyService.listAll({ organizationId: input.organizationId })
        : await apiKeyService.list({
            userId: ctx.session.user.id,
            organizationId: input.organizationId,
          });

      const allBindings = apiKeys.flatMap((k) => k.roleBindings);
      const { orgName, teamName, projectName, customRoleName, customRoles } =
        await apiKeyService.enrichBindingsWithNames({
          bindings: allBindings.map((rb) => ({
            id: rb.id,
            role: rb.role,
            customRoleId: rb.customRoleId,
            scopeType: rb.scopeType,
            scopeId: rb.scopeId,
          })),
        });

      const customRolePermissions = new Map(
        customRoles.map((r) => [
          r.id,
          Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
        ]),
      );

      const { users } = await apiKeyService.enrichApiKeyList({ apiKeys });
      const userName = new Map(users.map((u) => [u.id, u.name ?? u.email]));
      const userEmail = new Map(users.map((u) => [u.id, u.email]));

      return apiKeys.map((apiKey) => ({
        id: apiKey.id,
        lookupIdPrefix: apiKey.lookupId.slice(0, 5),
        name: apiKey.name,
        description: apiKey.description,
        permissionMode: apiKey.permissionMode,
        userId: apiKey.userId,
        userName: apiKey.userId ? (userName.get(apiKey.userId) ?? null) : null,
        userEmail: apiKey.userId
          ? (userEmail.get(apiKey.userId) ?? null)
          : null,
        createdByUserId: apiKey.createdByUserId,
        createdByUserName: apiKey.createdByUserId
          ? (userName.get(apiKey.createdByUserId) ?? null)
          : null,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        // Non-null marks this as an ingestion key (project-scoped, ingest-only
        // write credential the `langwatch <tool>` CLI mints). null = regular
        // personal / service key. Drives the API Keys page section split.
        ingestSourceType: apiKey.ingestSourceType,
        ingestionTemplateId: apiKey.ingestionTemplateId,
        // Human label of the CLI device session that minted this ingestion key
        // ("Rogerio's MacBook Pro"); null for keys without device provenance.
        createdByDeviceLabel: apiKey.createdByDeviceLabel,
        roleBindings: apiKey.roleBindings.map((rb) => ({
          id: rb.id,
          role: rb.role,
          customRoleId: rb.customRoleId,
          customRoleName: rb.customRoleId
            ? (customRoleName.get(rb.customRoleId) ?? null)
            : null,
          customRolePermissions: rb.customRoleId
            ? (customRolePermissions.get(rb.customRoleId) ?? null)
            : null,
          scopeType: rb.scopeType,
          scopeId: rb.scopeId,
          scopeName:
            rb.scopeType === RoleBindingScopeType.ORGANIZATION
              ? (orgName.get(rb.scopeId) ?? null)
              : rb.scopeType === RoleBindingScopeType.TEAM
                ? (teamName.get(rb.scopeId) ?? null)
                : (projectName.get(rb.scopeId) ?? null),
        })),
      }));
    }),

  create: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string(),
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          expiresAt: z.coerce.date().optional(),
          permissionMode: z.enum(API_KEY_PERMISSION_MODES).default("all"),
          keyType: z.enum(["personal", "service"]).default("personal"),
          assignedToUserId: z.string().optional(),
          permissions: z.array(permissionFormatSchema).optional(),
          bindings: z.array(roleBindingSchema).max(20),
        })
        .superRefine(refineRestrictedPermissions),
    )
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "creating API key for user's own org" },
    })
    .mutation(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      const isService = input.keyType === "service";

      // Service keys and assigning to another user both require admin
      if (
        isService ||
        (input.assignedToUserId &&
          input.assignedToUserId !== ctx.session.user.id)
      ) {
        const callerIsAdmin = await apiKeyService.isOrgAdmin({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
        if (!callerIsAdmin) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: isService
              ? "Only organization admins can create service API keys"
              : "Only organization admins can create API keys for other users",
          });
        }
      }

      const targetUserId = isService
        ? null
        : (input.assignedToUserId ?? ctx.session.user.id);
      const createdByUserId = ctx.session.user.id;
      try {
        const { token, apiKey } = await apiKeyService.create({
          name: input.name,
          description: input.description,
          userId: targetUserId,
          createdByUserId,
          organizationId: input.organizationId,
          expiresAt: input.expiresAt,
          permissionMode: input.permissionMode,
          permissions: input.permissions,
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
            permissionMode: input.permissionMode,
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
        mapApiKeyHandledError(error);
      }
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string(),
          apiKeyId: z.string(),
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).nullish(),
          permissionMode: z.enum(API_KEY_PERMISSION_MODES).optional(),
          permissions: z.array(permissionFormatSchema).optional(),
          bindings: z.array(roleBindingSchema).min(1).max(20).optional(),
        })
        .superRefine(refineRestrictedPermissions),
    )
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "updating API key" },
    })
    .mutation(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      const callerIsAdmin = await apiKeyService.isOrgAdmin({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      try {
        const updated = await apiKeyService.update({
          id: input.apiKeyId,
          callerUserId: ctx.session.user.id,
          callerIsAdmin,
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          permissionMode: input.permissionMode,
          permissions: input.permissions,
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
        mapApiKeyHandledError(error);
      }
    }),

  revoke: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        apiKeyId: z.string(),
      }),
    )
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "revoking API key" },
    })
    .mutation(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      const callerIsAdmin = await apiKeyService.isOrgAdmin({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });

      try {
        await apiKeyService.revoke({
          id: input.apiKeyId,
          callerUserId: ctx.session.user.id,
          callerIsAdmin,
          organizationId: input.organizationId,
        });

        void auditLog({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          action: "apiKey.revoke",
          args: { apiKeyId: input.apiKeyId },
        });
      } catch (error) {
        mapApiKeyHandledError(error);
      }
      return { success: true };
    }),

  /**
   * Returns all projects in the org for the restricted permissions picker.
   */
  orgProjects: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "listing org projects for permission picker" },
    })
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      return apiKeyService.getOrgProjects({
        organizationId: input.organizationId,
      });
    }),

  orgTeams: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "listing org teams for scope picker" },
    })
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      return apiKeyService.getOrgTeams({
        organizationId: input.organizationId,
      });
    }),

  orgMembers: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .noPermission({
      reason:
        "personal API keys are the caller's own; the handler proves organization membership and ownership itself",
      allow: { organizationId: "listing org members for key assignment" },
    })
    .query(async ({ ctx, input }) => {
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      await ensureCallerIsOrgMember(
        apiKeyService,
        ctx.session.user.id,
        input.organizationId,
      );
      const callerIsAdmin = await apiKeyService.isOrgAdmin({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
      });
      if (!callerIsAdmin) return [];

      return apiKeyService.getOrgMembers({
        organizationId: input.organizationId,
      });
    }),
});
