import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { DomainError } from "~/server/app-layer/domain-error";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { auditLog } from "~/server/auditLog";
import { skipPermissionCheck } from "../rbac";

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
      default:
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message, cause: error });
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
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        return await apiKeyService.getMyBindings({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }
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
      try {
        const callerIsAdmin = await apiKeyService.isOrgAdmin({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
        return await apiKeyService.getApiKeysWithNames({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          isAdmin: callerIsAdmin,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }
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
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        await apiKeyService.assertOrgMembership({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }

      const isService = input.keyType === "service";

      // Service keys and assigning to another user both require admin
      if (isService || (input.assignedToUserId && input.assignedToUserId !== ctx.session.user.id)) {
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

      const targetUserId = isService ? null : (input.assignedToUserId ?? ctx.session.user.id);
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
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        await apiKeyService.assertOrgMembership({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }

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
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        await apiKeyService.assertOrgMembership({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }

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
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        return await apiKeyService.getOrgProjects({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }
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
      const apiKeyService = ApiKeyService.create(ctx.prisma);
      try {
        return await apiKeyService.getOrgMembers({
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
        });
      } catch (error) {
        mapApiKeyDomainError(error);
      }
    }),
});
