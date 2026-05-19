import type { Organization } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyAlreadyRevokedError,
  ApiKeyScopeViolationError,
} from "~/server/api-key/errors";
import type { ApiKeyServiceMiddlewareVariables } from "../../middleware/api-key-service";
import { apiKeyServiceMiddleware } from "../../middleware/api-key-service";
import type { OrgAuthMiddlewareVariables } from "../../middleware/org-auth";
import { orgAuthMiddleware, requireOrgPermission } from "../../middleware/org-auth";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { handleApiKeyError } from "./error-handler";

patchZodOpenapi();

type Variables = OrgAuthMiddlewareVariables & ApiKeyServiceMiddlewareVariables;

const bindingSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

const createApiKeySchema = z.object({
  keyType: z.enum(["personal", "service"]).default("personal"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  expiresAt: z.coerce.date().optional(),
  bindings: z.array(bindingSchema).max(20).optional(),
  projectIds: z.array(z.string().min(1)).max(50).optional(),
}).refine(
  (data) => data.keyType === "service" || (data.bindings && data.bindings.length > 0),
  { message: "bindings are required for personal keys", path: ["bindings"] },
).refine(
  (data) => data.keyType === "service" || !data.projectIds || data.projectIds.length === 0,
  { message: "projectIds is only supported for service keys; use bindings instead", path: ["projectIds"] },
);

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
  .use(apiKeyServiceMiddleware)
  .onError(handleApiKeyError)

  .get(
    "/",
    describeRoute({
      description: "List all API keys for the authenticated user in this organization",
    }),
    requireOrgPermission("organization:view"),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const userId = c.get("apiKeyUserId") as string | null;
      const service = c.get("apiKeyService") as ApiKeyService;

      const keys = userId
        ? await service.list({ userId, organizationId: organization.id })
        : await service.listAll({ organizationId: organization.id });

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
      const callerUserId = c.get("apiKeyUserId") as string | null;
      const body = c.req.valid("json");
      const service = c.get("apiKeyService") as ApiKeyService;

      const isService = body.keyType === "service";
      const projectBindings = isService
        ? (body.projectIds ?? []).map((projectId: string) => ({
            role: "ADMIN" as const,
            scopeType: "PROJECT" as const,
            scopeId: projectId,
          }))
        : [];
      const bindings = [...(body.bindings ?? []), ...projectBindings];

      try {
        const result = await service.create({
          name: body.name,
          description: body.description,
          userId: isService ? null : callerUserId,
          createdByUserId: callerUserId,
          organizationId: organization.id,
          expiresAt: body.expiresAt,
          permissionMode: isService ? "all" : "restricted",
          bindings,
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
      const userId = c.get("apiKeyUserId") as string | null;
      const service = c.get("apiKeyService") as ApiKeyService;

      try {
        await service.revoke({
          id,
          callerUserId: userId ?? "",
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
