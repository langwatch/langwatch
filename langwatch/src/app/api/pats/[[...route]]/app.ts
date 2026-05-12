import type { Organization } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyAlreadyRevokedError,
  ApiKeyScopeViolationError,
} from "~/server/api-key/errors";
import type { OrgAuthMiddlewareVariables } from "../../middleware/org-auth";
import { orgAuthMiddleware, requireOrgPermission } from "../../middleware/org-auth";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { handleApiKeyError } from "./error-handler";

patchZodOpenapi();

type Variables = OrgAuthMiddlewareVariables;

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  expiresAt: z.coerce.date().optional(),
  bindings: z
    .array(
      z.object({
        role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string().min(1),
      }),
    )
    .min(1)
    .max(20),
});

function validationHook(
  result: {
    success: boolean;
    error?: {
      issues: Array<{ message?: string; path?: (string | number)[] }>;
    };
  },
  c: { json: (body: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json(
      {
        error: "Unprocessable Entity",
        message: issue?.message ?? "Validation failed",
        path: issue?.path,
      },
      422,
    );
  }
  return undefined;
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/api-keys")
  .use(tracerMiddleware({ name: "api-keys" }))
  .use(loggerMiddleware())
  .use(orgAuthMiddleware)
  .onError(handleApiKeyError)

  .get(
    "/",
    describeRoute({
      description: "List all API keys for the authenticated user in this organization",
    }),
    requireOrgPermission("organization:view"),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const userId = c.get("apiKeyUserId") as string;
      const service = ApiKeyService.create(prisma);

      const keys = await service.list({
        userId,
        organizationId: organization.id,
      });

      return c.json({
        data: keys.map((key) => ({
          id: key.id,
          name: key.name,
          description: key.description,
          createdAt: key.createdAt,
          expiresAt: key.expiresAt,
          lastUsedAt: key.lastUsedAt,
          revokedAt: key.revokedAt,
          roleBindings: key.roleBindings.map((rb) => ({
            id: rb.id,
            role: rb.role,
            scopeType: rb.scopeType,
            scopeId: rb.scopeId,
          })),
        })),
      });
    },
  )

  .post(
    "/",
    describeRoute({
      description: "Create a new API key",
    }),
    requireOrgPermission("organization:manage"),
    zValidator("json", createApiKeySchema, validationHook),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const userId = c.get("apiKeyUserId") as string;
      const body = c.req.valid("json");
      const service = ApiKeyService.create(prisma);

      try {
        const result = await service.create({
          name: body.name,
          description: body.description,
          userId,
          createdByUserId: userId,
          organizationId: organization.id,
          expiresAt: body.expiresAt,
          permissionMode: "scoped",
          bindings: body.bindings,
        });

        return c.json(
          {
            token: result.token,
            apiKey: {
              id: result.apiKey.id,
              name: result.apiKey.name,
              createdAt: result.apiKey.createdAt,
            },
          },
          201,
        );
      } catch (error) {
        if (error instanceof ApiKeyScopeViolationError) {
          return c.json(
            { error: "Forbidden", message: error.message },
            403,
          );
        }
        throw error;
      }
    },
  )

  .delete(
    "/:id",
    requireOrgPermission("organization:manage"),
    describeRoute({
      description: "Revoke an API key",
    }),
    async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization") as Organization;
      const userId = c.get("apiKeyUserId") as string;
      const service = ApiKeyService.create(prisma);

      try {
        await service.revoke({
          id,
          callerUserId: userId,
          callerIsAdmin: true,
          organizationId: organization.id,
        });
      } catch (error) {
        if (error instanceof ApiKeyNotFoundError) {
          return c.json(
            { error: "Not Found", message: "API key not found" },
            404,
          );
        }
        if (error instanceof ApiKeyNotOwnedError) {
          return c.json(
            { error: "Forbidden", message: error.message },
            403,
          );
        }
        if (error instanceof ApiKeyAlreadyRevokedError) {
          return c.json(
            { error: "Conflict", message: error.message },
            409,
          );
        }
        throw error;
      }

      return c.json({ success: true });
    },
  );
