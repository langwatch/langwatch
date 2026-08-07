import type { Organization } from "~/generated/prisma/client";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import type { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  ApiKeyAlreadyRevokedError,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyReservedNameError,
  ApiKeyScopeViolationError,
} from "~/server/api-key/errors";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import type { ApiKeyServiceMiddlewareVariables } from "../../middleware/api-key-service";
import { apiKeyServiceMiddleware } from "../../middleware/api-key-service";
import { handleApiKeyError } from "./error-handler";
import { CREATE_API_KEY, LIST_API_KEYS, REVOKE_API_KEY } from "./openapi";

patchZodOpenapi();

const bindingSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

const createApiKeySchema = z
  .object({
    keyType: z
      .enum(["personal", "service"])
      .default("personal")
      .describe(
        "A personal key acts as the user who created it and needs explicit bindings. A service key is not tied to a user.",
      ),
    name: z
      .string()
      .min(1)
      .max(100)
      .describe("Human-readable name for this key"),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce
      .date()
      .optional()
      .describe("ISO 8601 timestamp after which the key stops working"),
    bindings: z
      .array(bindingSchema)
      .max(20)
      .optional()
      .describe(
        "What this key may do, and where. Required for a personal key.",
      ),
    projectIds: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .describe("Service keys only: restricts the key to these projects"),
  })
  .refine(
    (data) =>
      data.keyType === "service" || (data.bindings && data.bindings.length > 0),
    { message: "bindings are required for personal keys", path: ["bindings"] },
  )
  .refine(
    (data) =>
      data.keyType === "service" ||
      !data.projectIds ||
      data.projectIds.length === 0,
    {
      message:
        "projectIds is only supported for service keys; use bindings instead",
      path: ["projectIds"],
    },
  );

const secured = createOrgApp<ApiKeyServiceMiddlewareVariables>({
  basePath: "/api/api-keys",
});

secured.hono.onError(handleApiKeyError);

secured
  .access(requires("organization:view"))
  .get(
    "/",
    apiKeyServiceMiddleware,
    describeRoute(LIST_API_KEYS),
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
  );

secured
  .access(requires("organization:manage"))
  .post(
    "/",
    apiKeyServiceMiddleware,
    describeRoute(CREATE_API_KEY),
    zValidator("json", createApiKeySchema),
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
          permissionMode: "all",
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
          return c.json({ error: "Forbidden", message: error.message }, 403);
        }
        if (error instanceof ApiKeyReservedNameError) {
          return c.json(
            { error: "Unprocessable Entity", message: error.message },
            422,
          );
        }
        throw error;
      }
    },
  );

secured
  .access(requires("organization:manage"))
  .delete(
    "/:id",
    apiKeyServiceMiddleware,
    describeRoute(REVOKE_API_KEY),
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
          return c.json({ error: "Forbidden", message: error.message }, 403);
        }
        if (error instanceof ApiKeyAlreadyRevokedError) {
          return c.json({ error: "Conflict", message: error.message }, 409);
        }
        throw error;
      }

      return c.json({ success: true });
    },
  );

export const app = secured.hono;
