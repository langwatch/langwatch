import {
  API_KEY_PERMISSION_MODES,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  apiKeyPermissionFormatSchema as permissionFormatSchema,
  apiKeyRestDetailSchema,
  apiKeyRestListSchema,
  apiKeyRestMintedSchema,
  apiKeyRestRevokedSchema,
  refineRestrictedPermissions,
  type ApiKeyDetail,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { Context } from "hono";
import { z } from "zod";

import { requires } from "@langwatch/api";
import {
  type AppRestManagementAuditPort,
  type AppRestSecurity,
  createFamilyErrorHandler,
  emitManagementAudit,
  handWrittenDocs,
  HttpError,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  organizationCredentialPrincipalOf,
} from "@langwatch/api/rest";
import {
  CREATE_API_KEY,
  GET_API_KEY,
  LIST_API_KEYS,
  REVOKE_API_KEY,
  UPDATE_API_KEY,
} from "../../rules/api-key-openapi.rules.ts";

const bindingSchema = z.object({
  role: z
    .enum(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"])
    .describe(
      "CUSTOM grants exactly the listed permissions and requires permissionMode 'restricted'.",
    ),
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

const permissionsSchema = z
  .array(permissionFormatSchema)
  .describe(
    "Restricted mode only: the exact resource:action permissions the key's CUSTOM bindings grant.",
  );

const permissionModeSchema = z
  .enum(API_KEY_PERMISSION_MODES)
  .describe(
    "'all' and 'readonly' take their meaning from the bindings alone; 'restricted' additionally requires an explicit permissions list.",
  );

const createApiKeySchema = z
  .object({
    keyType: z
      .enum(["personal", "service"])
      .default("personal")
      .describe(
        "A personal key acts as the user who created it and needs explicit bindings. A service key is not tied to a user.",
      ),
    name: z.string().min(1).max(100).describe("Human-readable name for this key"),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce
      .date()
      .optional()
      .describe("ISO 8601 timestamp after which the key stops working"),
    assignedToUserId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Organization admins only: the member who owns the key and whose access caps it. Defaults to the caller.",
      ),
    permissionMode: permissionModeSchema.default("all"),
    permissions: permissionsSchema.optional(),
    bindings: z
      .array(bindingSchema)
      .max(20)
      .optional()
      .describe("What this key may do, and where. Required for a personal key."),
    projectIds: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .describe("Service keys only: restricts the key to these projects"),
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
    permissionMode: permissionModeSchema.optional(),
    permissions: permissionsSchema.optional(),
    bindings: z
      .array(bindingSchema)
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Replaces the key's bindings outright. Whatever is accepted here is exactly what a subsequent GET returns.",
      ),
  })
  .superRefine(refineRestrictedPermissions);

/**
 * One key, as both endpoints that return a single key report it.
 *
 * `roleBindings` is the shape the listing already publishes, so a client that
 * parses a list row parses this too. `bindings` is the same set in the shape a
 * write accepts, which is what makes reading a key back after a write a
 * comparison rather than a translation.
 */
const apiKeyDetailResponse = (apiKey: ApiKeyDetail) => ({
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
  roleBindings: apiKey.roleBindings.map((rb) => ({
    id: rb.id,
    role: rb.role,
    scopeType: rb.scopeType,
    scopeId: rb.scopeId,
  })),
  bindings: apiKey.roleBindings.map((rb) => ({
    role: rb.role,
    scopeType: rb.scopeType,
    scopeId: rb.scopeId,
  })),
});

/**
 * Real adminness for the presented credential: an org-scope ADMIN role
 * binding on the calling user, or on the service key itself. Deliberately
 * stricter than holding organization:manage, which a custom role can carry.
 */
const resolveCallerIsAdmin = async ({
  service,
  organizationId,
  callerUserId,
  apiKeyId,
}: {
  service: ApiKeyService;
  organizationId: string;
  callerUserId: string | null;
  apiKeyId: string;
}): Promise<boolean> =>
  callerUserId
    ? service.isOrgAdmin({ userId: callerUserId, organizationId })
    : service.isOrgAdminApiKey({ apiKeyId, organizationId });

/**
 * Whether the credential may read a key it does not own.
 *
 * Real organization adminness AND organization:manage, the same pair the
 * org-wide listing requires: reading someone else's key by id discloses what
 * the listing discloses, one row at a time, so it cannot be the cheaper of the
 * two to reach.
 */
const resolveCallerCanReadAnyKey = async ({
  apiKeyId,
  service,
  permissions,
  organizationId,
  callerUserId,
}: {
  apiKeyId: string;
  service: ApiKeyService;
  permissions: AuthzService;
  organizationId: string;
  callerUserId: string | null;
}): Promise<boolean> => {
  const callerIsAdmin = await resolveCallerIsAdmin({
    service,
    organizationId,
    callerUserId,
    apiKeyId,
  });
  if (!callerIsAdmin) return false;
  return permissions.hasApiKeyPermission({
    apiKeyId,
    userId: callerUserId,
    organizationId,
    scope: { type: "org", id: organizationId },
    permission: "organization:manage",
  });
};

/**
 * Who the new key acts as: nobody for a service key, otherwise the member it
 * was requested for (an admin-only choice, refused above for anyone else),
 * or the caller. An assignment on a service key has nothing to bind to, so it
 * is ignored, exactly as the tRPC path ignores it.
 */
const resolveKeyOwner = ({
  isService,
  assignedToUserId,
  callerUserId,
}: {
  isService: boolean;
  assignedToUserId?: string;
  callerUserId: string | null;
}): string | null => (isService ? null : (assignedToUserId ?? callerUserId));

/**
 * The bindings a create request asks for. A service key may state its reach as
 * `projectIds`, which is shorthand for one ADMIN binding per project; the
 * schema refuses that shorthand on a personal key, which states its bindings
 * outright.
 */
const requestedBindings = ({
  isService,
  bindings,
  projectIds,
}: {
  isService: boolean;
  bindings?: Array<{
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  projectIds?: string[];
}) => [
  ...(bindings ?? []),
  ...(isService ? (projectIds ?? []) : []).map((projectId) => ({
    role: "ADMIN" as const,
    scopeType: "PROJECT" as const,
    scopeId: projectId,
  })),
];

/**
 * A refusal this family decides in the handler, in the flat body it has always
 * answered. A plain {@link HttpError} publishes the sentence as the `error`
 * field; this door publishes the class of refusal there and the sentence
 * beside it.
 */
class ApiKeyForbidden extends HttpError {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.error = "Forbidden";
  }
}

const idParamsSchema = z.object({ id: z.string().min(1) });

/** The 403 sentence for the privilege the mint asked for and did not hold. */
const privilegedMintRefusal = ({
  isService,
  isAssignedToAnother,
}: {
  isService: boolean;
  isAssignedToAnother: boolean;
}): string => {
  if (isService) return "Only organization admins can create service API keys";
  if (isAssignedToAnother) {
    return "Only organization admins can create API keys for other users";
  }
  return "Only organization admins can create API keys that no member owns";
};

/**
 * A key nobody owns has no user ceiling, and an unbound one defaults to
 * org-wide ADMIN; a key minted for somebody else is capped by THEIR access
 * rather than the caller's. Both are mints the tRPC path reserves for real
 * organization admins, so the REST path sets the same bar. Returns the 403 to
 * send, or null when the mint may proceed (a personal key for yourself always
 * may, since your own ceiling caps it).
 *
 * Ownerlessness is decided by {@link resolveKeyOwner}, not by `keyType`: a
 * service credential acts as nobody, so `keyType: "personal"` with no
 * assignment resolves to the same unowned, org-wide-ADMIN key a service key
 * would, and asking about `keyType` alone would wave it through.
 */
const refuseNonAdminPrivilegedMint = async ({
  apiKeyId,
  service,
  organizationId,
  callerUserId,
  isService,
  assignedToUserId,
}: {
  apiKeyId: string;
  service: ApiKeyService;
  organizationId: string;
  callerUserId: string | null;
  isService: boolean;
  assignedToUserId?: string;
}): Promise<void> => {
  const isAssignedToAnother = !isService && !!assignedToUserId && assignedToUserId !== callerUserId;
  const owner = resolveKeyOwner({ isService, assignedToUserId, callerUserId });
  if (owner !== null && !isAssignedToAnother) return;
  const callerIsAdmin = await resolveCallerIsAdmin({
    service,
    organizationId,
    callerUserId,
    apiKeyId,
  });
  if (callerIsAdmin) return;
  throw new ApiKeyForbidden(privilegedMintRefusal({ isService, isAssignedToAnother }));
};

/**
 * REST for the organization's API keys.
 *
 * The API-key and authorization capabilities arrive as services rather than
 * being read off the request, so this family can be mounted into any process
 * that has them.
 */
export function createApiKeysRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  apiKeys: () => ApiKeyService;
  permissions: () => AuthzService;
  audit: AppRestManagementAuditPort;
}): MountableRestApp {
  const { security, apiKeys, permissions, audit } = options;

  const { service, policy } = security.createVersionedApp({
    name: "api-keys",
    basePath: "/api/api-keys",
    errorEnvelope: "legacy",
    errorHandler: (boundary) =>
      createFamilyErrorHandler({
        loggerName: "langwatch:api:api-keys:errors",
        label: "API Keys Error",
        boundary,
      }),
  });

  const listHandler = async (c: Context) => {
    const organization = c.get("organization");
    const credential = organizationCredentialPrincipalOf(c);
    const userId = credential.userId;
    const keys = apiKeys();

    if (!userId) {
      const canManage = await permissions().hasApiKeyPermission({
        apiKeyId: credential.apiKeyId,
        userId: null,
        organizationId: organization.id,
        scope: { type: "org", id: organization.id },
        permission: "organization:manage",
      });
      if (!canManage) {
        throw new ApiKeyForbidden(
          "Listing every API key in the organization requires the organization:manage permission",
        );
      }
    }

    const rows = userId
      ? await keys.list({ userId, organizationId: organization.id })
      : await keys.listAll({ organizationId: organization.id });

    return {
      data: rows.map((key) => ({
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
    };
  };

  const createHandler = async (c: Context, input: z.infer<typeof createApiKeySchema>) => {
    const organization = c.get("organization");
    const credential = organizationCredentialPrincipalOf(c);
    const callerUserId = credential.userId;
    const keys = apiKeys();
    const isService = input.keyType === "service";

    await refuseNonAdminPrivilegedMint({
      apiKeyId: credential.apiKeyId,
      service: keys,
      organizationId: organization.id,
      callerUserId,
      isService,
      ...(input.assignedToUserId === undefined ? {} : { assignedToUserId: input.assignedToUserId }),
    });

    const result = await keys.create({
      name: input.name,
      description: input.description,
      userId: resolveKeyOwner({
        isService,
        ...(input.assignedToUserId === undefined
          ? {}
          : { assignedToUserId: input.assignedToUserId }),
        callerUserId,
      }),
      createdByUserId: callerUserId,
      organizationId: organization.id,
      expiresAt: input.expiresAt,
      permissionMode: input.permissionMode,
      permissions: input.permissions,
      bindings: requestedBindings({
        isService,
        ...(input.bindings === undefined ? {} : { bindings: input.bindings }),
        ...(input.projectIds === undefined ? {} : { projectIds: input.projectIds }),
      }),
    });

    return {
      token: result.token,
      apiKey: {
        id: result.apiKey.id,
        name: result.apiKey.name,
        createdAt: result.apiKey.createdAt,
      },
    };
  };

  const getHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => {
    const organization = c.get("organization");
    const credential = organizationCredentialPrincipalOf(c);
    const callerUserId = credential.userId;
    const keys = apiKeys();

    const apiKey = await keys.getByIdForCaller({
      id: input.id,
      organizationId: organization.id,
      callerUserId,
      callerCanReadAnyKey: await resolveCallerCanReadAnyKey({
        apiKeyId: credential.apiKeyId,
        service: keys,
        permissions: permissions(),
        organizationId: organization.id,
        callerUserId,
      }),
    });

    // The detail response names the member the key acts as and the member who
    // minted it, so an admin can walk the organization's credentials one id at
    // a time. That disclosure is auditable like the writes are.
    emitManagementAudit({
      c,
      audit,
      organizationId: organization.id,
      action: "management.apiKey.read",
      args: { apiKeyId: input.id },
    });

    return apiKeyDetailResponse(apiKey);
  };

  const updateHandler = async (
    c: Context,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateApiKeySchema>,
  ) => {
    const organization = c.get("organization");
    const credential = organizationCredentialPrincipalOf(c);
    const callerUserId = credential.userId;
    const keys = apiKeys();

    const callerIsAdmin = await resolveCallerIsAdmin({
      service: keys,
      organizationId: organization.id,
      callerUserId,
      apiKeyId: credential.apiKeyId,
    });

    try {
      await keys.update({
        id: input.id,
        callerUserId,
        callerIsAdmin,
        organizationId: organization.id,
        name: input.name,
        description: input.description,
        permissionMode: input.permissionMode,
        permissions: input.permissions,
        bindings: input.bindings,
      });
    } catch (error) {
      // Editing somebody else's key answers exactly as fetching it does: the id
      // names nothing this caller can reach. A 403 here would confirm it names
      // a real key.
      if (error instanceof ApiKeyNotOwnedError) {
        throw new ApiKeyNotFoundError(input.id, { reasons: [error] });
      }
      throw error;
    }

    emitManagementAudit({
      c,
      audit,
      organizationId: organization.id,
      action: "management.apiKey.update",
      args: { apiKeyId: input.id },
    });

    // Read back through the same path GET serves, so the two can never describe
    // the key differently. The route already demanded organization:manage, so
    // adminness alone decides the ownership branch.
    return apiKeyDetailResponse(
      await keys.getByIdForCaller({
        id: input.id,
        organizationId: organization.id,
        callerUserId,
        callerCanReadAnyKey: callerIsAdmin,
      }),
    );
  };

  const revokeHandler = async (c: Context, input: z.infer<typeof idParamsSchema>) => {
    const organization = c.get("organization");
    const credential = organizationCredentialPrincipalOf(c);
    const userId = credential.userId;
    const keys = apiKeys();

    // Real adminness, so revoke() can enforce its owner-only path: without
    // this, any organization:manage holder could revoke anyone's key.
    const callerIsAdmin = await resolveCallerIsAdmin({
      service: keys,
      organizationId: organization.id,
      callerUserId: userId,
      apiKeyId: credential.apiKeyId,
    });

    await keys.revoke({
      id: input.id,
      callerUserId: userId,
      callerIsAdmin,
      organizationId: organization.id,
    });

    return { success: true };
  };

  return (
    service
      // The route policy is organization:view for the caller's OWN keys. The
      // org-wide listing a service credential receives is a different
      // disclosure (every key in the organization), so that branch
      // additionally requires organization:manage in the handler.
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("organization:view"))(b)
          .withOutput(apiKeyRestListSchema)
          .withDocs(handWrittenDocs(LIST_API_KEYS)),
      )
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("organization:manage"))(b)
          .withInput(createApiKeySchema)
          .withOutput(apiKeyRestMintedSchema)
          .withStatus(201)
          .withDocs(handWrittenDocs(CREATE_API_KEY)),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("organization:view"))(b)
          .withParams(idParamsSchema)
          .withOutput(apiKeyRestDetailSchema)
          .withDocs(handWrittenDocs(GET_API_KEY)),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requires("organization:manage"))(b)
          .withParams(idParamsSchema)
          .withInput(updateApiKeySchema)
          .withOutput(apiKeyRestDetailSchema)
          .withDocs(handWrittenDocs(UPDATE_API_KEY)),
      )
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, revokeHandler, (b) =>
        policy(requires("organization:manage"))(b)
          .withParams(idParamsSchema)
          .withOutput(apiKeyRestRevokedSchema)
          .withDocs(handWrittenDocs(REVOKE_API_KEY)),
      )
      .build()
  );
}
