import {
  API_KEY_PERMISSION_MODES,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  type ApiKeyDetail,
  type ApiKeyService,
  type ApiKeyScope,
  apiKeyPermissionFormatSchema,
  refineRestrictedPermissions,
} from "@langwatch/api-key-contract";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  ApiOrganizationRestSecurityPolicy,
  type ApiOrganizationRestSecurityPort,
} from "./api-rest.security";
import type { ApiAuditPort } from "./api-request.policy";

const bindingSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]),
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

const createApiKeySchema = z
  .object({
    keyType: z.enum(["personal", "service"]).default("personal"),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce.date().optional(),
    assignedToUserId: z.string().min(1).optional(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).default("all"),
    permissions: z.array(apiKeyPermissionFormatSchema).optional(),
    bindings: z.array(bindingSchema).max(20).optional(),
    projectIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((data) => data.keyType === "service" || (data.bindings && data.bindings.length > 0), {
    message: "bindings are required for personal keys",
    path: ["bindings"],
  })
  .refine(
    (data) => data.keyType === "service" || !data.projectIds || data.projectIds.length === 0,
    {
      message: "projectIds is only supported for service keys; use bindings instead",
      path: ["projectIds"],
    },
  )
  .superRefine(refineRestrictedPermissions);

const updateApiKeySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullish(),
    permissionMode: z.enum(API_KEY_PERMISSION_MODES).optional(),
    permissions: z.array(apiKeyPermissionFormatSchema).optional(),
    bindings: z.array(bindingSchema).min(1).max(20).optional(),
  })
  .superRefine(refineRestrictedPermissions);

/** Installs the existing organization API-key management paths in the API process. */
export class ApiKeyManagementRestFeature {
  static create(options: {
    apiKeys: ApiKeyService;
    security: ApiOrganizationRestSecurityPort;
    audit?: ApiAuditPort;
    logger?: Pick<Logger, "error">;
  }): Hono {
    const security = ApiOrganizationRestSecurityPolicy.create(options.security);
    const audit = new ApiKeyManagementAudit(
      options.audit,
      options.logger ?? createLogger("langwatch:api:api-key-management"),
    );
    const app = new Hono();
    app.onError((error, context) => apiKeyManagementErrorResponse(error, context));
    app.use("*", security.authenticationMiddleware());

    app.get("/", security.permissionMiddleware("organization:view"), async (context) => {
      const request = security.request(context);
      if (!request.actor && !(await hasOrganizationManagePermission(security, context))) {
        throw new ApiKeyManagementForbiddenError(
          "Listing every API key in the organization requires the organization:manage permission",
        );
      }

      const keys = request.actor
        ? await options.apiKeys.list({
            userId: request.actor.id,
            organizationId: request.organizationId,
          })
        : await options.apiKeys.listAll({ organizationId: request.organizationId });

      return context.json({ data: keys.map(apiKeyListItem) });
    });

    app.post("/", security.permissionMiddleware("organization:manage"), async (context) => {
      const request = security.request(context);
      const body = await validatedJson(context, createApiKeySchema);
      const isService = body.keyType === "service";
      const owner = resolveKeyOwner({
        isService,
        assignedToUserId: body.assignedToUserId,
        callerUserId: request.actor?.id ?? null,
      });
      const isAssignedToAnother =
        !isService && Boolean(body.assignedToUserId) && body.assignedToUserId !== request.actor?.id;
      if ((owner === null || isAssignedToAnother) && !(await security.isAdmin(context))) {
        throw new ApiKeyManagementForbiddenError(
          privilegedMintRefusal({ isService, isAssignedToAnother }),
        );
      }

      const result = await options.apiKeys.create({
        name: body.name,
        description: body.description,
        userId: owner,
        createdByUserId: request.actor?.id ?? null,
        organizationId: request.organizationId,
        expiresAt: body.expiresAt,
        permissionMode: body.permissionMode,
        permissions: body.permissions,
        bindings: requestedBindings({
          isService,
          bindings: body.bindings,
          projectIds: body.projectIds,
        }),
      });

      return context.json(
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
    });

    app.get("/:id", security.permissionMiddleware("organization:view"), async (context) => {
      const request = security.request(context);
      const apiKey = await options.apiKeys.getByIdForCaller({
        id: context.req.param("id"),
        organizationId: request.organizationId,
        callerUserId: request.actor?.id ?? null,
        callerCanReadAnyKey:
          (await security.isAdmin(context)) &&
          (await hasOrganizationManagePermission(security, context)),
      });
      audit.record({
        request,
        path: context.req.path,
        action: "management.apiKey.read",
        args: { apiKeyId: apiKey.id },
      });
      return context.json(apiKeyDetailResponse(apiKey));
    });

    app.patch("/:id", security.permissionMiddleware("organization:manage"), async (context) => {
      const request = security.request(context);
      const body = await validatedJson(context, updateApiKeySchema);
      const callerIsAdmin = await security.isAdmin(context);
      const id = context.req.param("id");
      try {
        await options.apiKeys.update({
          id,
          callerUserId: request.actor?.id ?? null,
          callerIsAdmin,
          organizationId: request.organizationId,
          name: body.name,
          description: body.description,
          permissionMode: body.permissionMode,
          permissions: body.permissions,
          bindings: body.bindings,
        });
      } catch (error) {
        if (error instanceof ApiKeyNotOwnedError) {
          throw new ApiKeyNotFoundError(id, { reasons: [error] });
        }
        throw error;
      }

      const updated = await options.apiKeys.getByIdForCaller({
        id,
        organizationId: request.organizationId,
        callerUserId: request.actor?.id ?? null,
        callerCanReadAnyKey: callerIsAdmin,
      });
      audit.record({
        request,
        path: context.req.path,
        action: "management.apiKey.update",
        args: { apiKeyId: id },
      });
      return context.json(apiKeyDetailResponse(updated));
    });

    app.delete("/:id", security.permissionMiddleware("organization:manage"), async (context) => {
      const request = security.request(context);
      await options.apiKeys.revoke({
        id: context.req.param("id"),
        callerUserId: request.actor?.id ?? null,
        callerIsAdmin: await security.isAdmin(context),
        organizationId: request.organizationId,
      });
      return context.json({ success: true });
    });

    return new Hono().route("/api/api-keys", app);
  }
}

class ApiKeyManagementForbiddenError extends HandledError {
  readonly legacyError = "Forbidden";

  constructor(message: string) {
    super("insufficient_permissions", message, { httpStatus: 403, fault: "customer" });
    this.name = "ApiKeyManagementForbiddenError";
  }
}

class ApiKeyManagementMalformedRequestError extends HandledError {
  constructor() {
    super("malformed_request", "The request body could not be parsed.", {
      httpStatus: 400,
      fault: "customer",
      meta: { target: "json" },
    });
    this.name = "ApiKeyManagementMalformedRequestError";
  }
}

class ApiKeyManagementAudit {
  constructor(
    private readonly audit: ApiAuditPort | undefined,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  record(input: {
    request: { actor: { id: string } | null; apiKeyId: string; organizationId: string };
    path: string;
    action: "management.apiKey.read" | "management.apiKey.update";
    args: Record<string, string>;
  }): void {
    void this.audit
      ?.record({
        actorId: input.request.actor?.id ?? `apikey:${input.request.apiKeyId}`,
        path: input.path,
        input: {
          organizationId: input.request.organizationId,
          action: input.action,
          args: input.args,
        },
        error: null,
      })
      .catch((error) => {
        this.logger.error(
          { error, action: input.action, path: input.path },
          "Management audit failed",
        );
      });
  }
}

async function hasOrganizationManagePermission(
  security: ApiOrganizationRestSecurityPolicy,
  context: Context,
): Promise<boolean> {
  try {
    await security.authorize(context, "organization:manage");
    return true;
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === "insufficient_permissions") {
      return false;
    }
    throw error;
  }
}

async function validatedJson<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  let json: unknown;
  try {
    json = await context.req.json();
  } catch {
    throw new ApiKeyManagementMalformedRequestError();
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ValidationError("The request body didn't match the expected shape.", {
    fault: "customer",
    meta: { target: "json", fields: parsed.error.issues.map((issue) => issue.path.join(".")) },
  });
}

function apiKeyManagementErrorResponse(error: Error, context: Context): Response {
  if (HandledError.isHandled(error)) {
    const legacyError = "legacyError" in error ? error.legacyError : error.code;
    return context.json(
      {
        error: legacyError,
        message: error.message,
        ...error.meta,
        retryable: error.retryable,
        ...(error.tips.length ? { tips: error.tips } : {}),
        ...(error.docsUrl ? { docsUrl: error.docsUrl } : {}),
        ...(error.reasons.length ? { reasons: error.serialize().reasons } : {}),
      },
      error.httpStatus as 400 | 401 | 403 | 404 | 409 | 422 | 500,
    );
  }
  return context.json(
    { error: "Internal server error", message: "An unknown error occurred" },
    500,
  );
}

function apiKeyListItem(apiKey: Awaited<ReturnType<ApiKeyService["list"]>>[number]) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    description: apiKey.description,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    roleBindings: apiKey.roleBindings.map(apiKeyBindingResponse),
  };
}

function apiKeyDetailResponse(apiKey: ApiKeyDetail) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    description: apiKey.description,
    keyType: apiKey.userId ? "personal" : "service",
    assignedToUserId: apiKey.userId,
    createdByUserId: apiKey.createdByUserId,
    permissionMode: apiKey.permissionMode,
    permissions: apiKey.permissions,
    createdAt: apiKey.createdAt,
    expiresAt: apiKey.expiresAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    roleBindings: apiKey.roleBindings.map(apiKeyBindingResponse),
    bindings: apiKey.roleBindings.map(apiKeyBindingResponse),
  };
}

function apiKeyBindingResponse(binding: ApiKeyScope & { id: string }) {
  return {
    id: binding.id,
    role: binding.role,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
  };
}

function resolveKeyOwner(input: {
  isService: boolean;
  assignedToUserId: string | undefined;
  callerUserId: string | null;
}): string | null {
  return input.isService ? null : (input.assignedToUserId ?? input.callerUserId);
}

function requestedBindings(input: {
  isService: boolean;
  bindings: z.output<typeof bindingSchema>[] | undefined;
  projectIds: string[] | undefined;
}): z.output<typeof bindingSchema>[] {
  return [
    ...(input.bindings ?? []),
    ...(input.isService ? (input.projectIds ?? []) : []).map((projectId) => ({
      role: "ADMIN" as const,
      scopeType: "PROJECT" as const,
      scopeId: projectId,
    })),
  ];
}

function privilegedMintRefusal(input: {
  isService: boolean;
  isAssignedToAnother: boolean;
}): string {
  if (input.isService) return "Only organization admins can create service API keys";
  if (input.isAssignedToAnother) {
    return "Only organization admins can create API keys for other users";
  }
  return "Only organization admins can create API keys that no member owns";
}
