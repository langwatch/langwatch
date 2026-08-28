import {
  API_KEY_PERMISSION_MODES,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  apiKeyPermissionFormatSchema as permissionFormatSchema,
  refineRestrictedPermissions,
  type ApiKeyDetail,
  type ApiKeyService,
} from "@langwatch/api-key-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import {
  type AppRestManagementAuditPort,
  type AppRestOrganizationVariables,
  type AppRestSecurity,
  createFamilyErrorHandler,
  emitManagementAudit,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";
import {
  CREATE_API_KEY,
  GET_API_KEY,
  LIST_API_KEYS,
  REVOKE_API_KEY,
  UPDATE_API_KEY,
} from "./api-keys-rest.openapi";

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
  c,
  service,
  permissions,
  organizationId,
  callerUserId,
}: {
  c: Context;
  service: ApiKeyService;
  permissions: AuthzService;
  organizationId: string;
  callerUserId: string | null;
}): Promise<boolean> => {
  const apiKeyId = c.get("apiKeyId") as string;
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
  c,
  service,
  organizationId,
  callerUserId,
  isService,
  assignedToUserId,
}: {
  c: Context;
  service: ApiKeyService;
  organizationId: string;
  callerUserId: string | null;
  isService: boolean;
  assignedToUserId?: string;
}): Promise<Response | null> => {
  const isAssignedToAnother = !isService && !!assignedToUserId && assignedToUserId !== callerUserId;
  const owner = resolveKeyOwner({ isService, assignedToUserId, callerUserId });
  if (owner !== null && !isAssignedToAnother) return null;
  const callerIsAdmin = await resolveCallerIsAdmin({
    service,
    organizationId,
    callerUserId,
    apiKeyId: c.get("apiKeyId") as string,
  });
  if (callerIsAdmin) return null;
  return c.json(
    {
      error: "Forbidden",
      message: privilegedMintRefusal({ isService, isAssignedToAnother }),
    },
    403,
  );
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
}): SecuredApp<{ Variables: AppRestOrganizationVariables }> {
  const { security, apiKeys, permissions, audit } = options;

  const secured = security.createOrgApp({
    basePath: "/api/api-keys",
  });

  secured.hono.onError(
    createFamilyErrorHandler({
      loggerName: "langwatch:api:api-keys:errors",
      label: "API Keys Error",
      boundary: security.legacyErrorHandler,
    }),
  );

  // The route policy is organization:view for the caller's OWN keys. The
  // org-wide listing a service credential receives is a different disclosure
  // (every key in the organization), so that branch additionally requires
  // organization:manage in the handler.
  secured
    .access(requires("organization:view"))
    .get("/", describeRoute(LIST_API_KEYS), async (c) => {
      const organization = c.get("organization");
      const userId = c.get("apiKeyUserId");
      const service = apiKeys();

      if (!userId) {
        const canManage = await permissions().hasApiKeyPermission({
          apiKeyId: c.get("apiKeyId"),
          userId: null,
          organizationId: organization.id,
          scope: { type: "org", id: organization.id },
          permission: "organization:manage",
        });
        if (!canManage) {
          return c.json(
            {
              error: "Forbidden",
              message:
                "Listing every API key in the organization requires the organization:manage permission",
            },
            403,
          );
        }
      }

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
    });

  secured
    .access(requires("organization:manage"))
    .post("/", describeRoute(CREATE_API_KEY), zValidator("json", createApiKeySchema), async (c) => {
      const organization = c.get("organization");
      const callerUserId = c.get("apiKeyUserId");
      const body = c.req.valid("json");
      const service = apiKeys();

      const isService = body.keyType === "service";

      const mintRefusal = await refuseNonAdminPrivilegedMint({
        c,
        service,
        organizationId: organization.id,
        callerUserId,
        isService,
        assignedToUserId: body.assignedToUserId,
      });
      if (mintRefusal) return mintRefusal;

      const result = await service.create({
        name: body.name,
        description: body.description,
        userId: resolveKeyOwner({
          isService,
          assignedToUserId: body.assignedToUserId,
          callerUserId,
        }),
        createdByUserId: callerUserId,
        organizationId: organization.id,
        expiresAt: body.expiresAt,
        permissionMode: body.permissionMode,
        permissions: body.permissions,
        bindings: requestedBindings({
          isService,
          bindings: body.bindings,
          projectIds: body.projectIds,
        }),
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
    });

  secured
    .access(requires("organization:view"))
    .get("/:id", describeRoute(GET_API_KEY), async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const callerUserId = c.get("apiKeyUserId");
      const service = apiKeys();

      const apiKey = await service.getByIdForCaller({
        id,
        organizationId: organization.id,
        callerUserId,
        callerCanReadAnyKey: await resolveCallerCanReadAnyKey({
          c,
          service,
          permissions: permissions(),
          organizationId: organization.id,
          callerUserId,
        }),
      });

      // The detail response names the member the key acts as and the member
      // who minted it, so an admin can walk the organization's credentials one
      // id at a time. That disclosure is auditable like the writes are.
      emitManagementAudit({
        c,
        audit,
        organizationId: organization.id,
        action: "management.apiKey.read",
        args: { apiKeyId: id },
      });

      return c.json(apiKeyDetailResponse(apiKey));
    });

  secured
    .access(requires("organization:manage"))
    .patch(
      "/:id",
      describeRoute(UPDATE_API_KEY),
      zValidator("json", updateApiKeySchema),
      async (c) => {
        const { id } = c.req.param();
        const organization = c.get("organization");
        const callerUserId = c.get("apiKeyUserId");
        const service = apiKeys();
        const body = c.req.valid("json");

        const callerIsAdmin = await resolveCallerIsAdmin({
          service,
          organizationId: organization.id,
          callerUserId,
          apiKeyId: c.get("apiKeyId"),
        });

        try {
          await service.update({
            id,
            callerUserId,
            callerIsAdmin,
            organizationId: organization.id,
            name: body.name,
            description: body.description,
            permissionMode: body.permissionMode,
            permissions: body.permissions,
            bindings: body.bindings,
          });
        } catch (error) {
          // Editing somebody else's key answers exactly as fetching it does:
          // the id names nothing this caller can reach. A 403 here would
          // confirm it names a real key.
          if (error instanceof ApiKeyNotOwnedError) {
            throw new ApiKeyNotFoundError(id, { reasons: [error] });
          }
          throw error;
        }

        emitManagementAudit({
          c,
          audit,
          organizationId: organization.id,
          action: "management.apiKey.update",
          args: { apiKeyId: id },
        });

        // Read back through the same path GET serves, so the two can never
        // describe the key differently. The route already demanded
        // organization:manage, so adminness alone decides the ownership
        // branch.
        const updated = await service.getByIdForCaller({
          id,
          organizationId: organization.id,
          callerUserId,
          callerCanReadAnyKey: callerIsAdmin,
        });

        return c.json(apiKeyDetailResponse(updated));
      },
    );

  secured
    .access(requires("organization:manage"))
    .delete("/:id", describeRoute(REVOKE_API_KEY), async (c) => {
      const { id } = c.req.param();
      const organization = c.get("organization");
      const userId = c.get("apiKeyUserId");
      const service = apiKeys();

      // Real adminness, so revoke() can enforce its owner-only path: without
      // this, any organization:manage holder could revoke anyone's key.
      const callerIsAdmin = await resolveCallerIsAdmin({
        service,
        organizationId: organization.id,
        callerUserId: userId,
        apiKeyId: c.get("apiKeyId"),
      });

      await service.revoke({
        id,
        callerUserId: userId,
        callerIsAdmin,
        organizationId: organization.id,
      });

      return c.json({ success: true });
    });

  return secured;
}
