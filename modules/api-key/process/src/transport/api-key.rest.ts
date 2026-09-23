/**
 * `/api/api-keys` — the organization's own credentials, behind an organization
 * key. The door resolves the organization; the credential arrives as a bound
 * fact, because two questions here are asked of the KEY as well as the member.
 */
import {
  ApiKeyAdminRequiredError,
  ApiKeyApi,
  apiKeyRestCreateSchema,
  apiKeyRestDetailSchema,
  apiKeyRestListSchema,
  apiKeyRestMintedSchema,
  apiKeyRestParamsSchema,
  apiKeyRestRevokedSchema,
  apiKeyRestUpdateSchema,
  type ApiKeyAdminRequiredAction,
  type ApiKeyCredentialCheck,
  type ApiKeyDetail,
  type ApiKeyRestBinding,
  type ApiKeyRestDetail,
} from "@langwatch/api-key-contract";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { z } from "zod";

/** Every operation in this family is filed under one tag. */
const API_KEY_TAGS = ["API Keys"] as const;

const INVALID_TOKEN: Readonly<{ status: 401; description: string }> = {
  status: 401,
  description: "Invalid or missing API key token",
};

/**
 * The organization credential this door resolved: the key, and the member it
 * acts as — null for a service key, which acts as nobody.
 */
export const apiKeyRestCredential = defineRestMiddleware(
  "apiKeyRestCredential",
  z.object({ apiKeyId: z.string(), userId: z.string().nullable() }),
);

/** The credential, as the two organization-wide questions ask about it. */
type ApiKeyRestCaller = z.infer<(typeof apiKeyRestCredential)["schema"]>;

const credentialCheck = (
  caller: ApiKeyRestCaller,
  organizationId: string,
): ApiKeyCredentialCheck => ({
  apiKeyId: caller.apiKeyId,
  userId: caller.userId,
  organizationId,
});

/**
 * One key, as both endpoints that return a single key report it.
 * `roleBindings` is the shape the listing publishes; `bindings` is the same set
 * in the shape a write accepts, so a read-back is a comparison, not a mapping.
 */
const detailOf = (apiKey: ApiKeyDetail): ApiKeyRestDetail => ({
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
const callerIsAdmin = async ({
  app,
  caller,
  organizationId,
}: {
  app: ApiKeyApi;
  caller: ApiKeyRestCaller;
  organizationId: string;
}): Promise<boolean> =>
  caller.userId
    ? app.isOrgAdmin({ userId: caller.userId, organizationId })
    : app.isOrgAdminApiKey({ apiKeyId: caller.apiKeyId, organizationId });

/**
 * Whether the credential may read a key it does not own: real adminness AND
 * organization:manage, the pair the org-wide listing requires. Reading another
 * member's key by id discloses the same thing, one row at a time.
 */
const callerCanReadAnyKey = async ({
  app,
  caller,
  organizationId,
}: {
  app: ApiKeyApi;
  caller: ApiKeyRestCaller;
  organizationId: string;
}): Promise<boolean> => {
  if (!(await callerIsAdmin({ app, caller, organizationId }))) return false;

  return app.credentialCanManageOrganization(credentialCheck(caller, organizationId));
};

/**
 * Who the new key acts as: nobody for a service key, otherwise the member it
 * was requested for (an admin-only choice) or the caller. An assignment on a
 * service key has nothing to bind to, so it is ignored, as tRPC ignores it.
 */
const keyOwner = ({
  isService,
  assignedToUserId,
  callerUserId,
}: {
  isService: boolean;
  assignedToUserId?: string | undefined;
  callerUserId: string | null;
}): string | null => (isService ? null : (assignedToUserId ?? callerUserId));

/**
 * The bindings a create request asks for. A service key may state its reach as
 * `projectIds`, shorthand for one ADMIN binding per project; the schema refuses
 * that shorthand on a personal key, which states its bindings outright.
 */
const requestedBindings = ({
  isService,
  bindings,
  projectIds,
}: {
  isService: boolean;
  bindings?: readonly ApiKeyRestBinding[] | undefined;
  projectIds?: readonly string[] | undefined;
}): ApiKeyRestBinding[] => [
  ...(bindings ?? []),
  ...(isService ? (projectIds ?? []) : []).map((projectId) => ({
    role: "ADMIN" as const,
    scopeType: "PROJECT" as const,
    scopeId: projectId,
  })),
];

/** The privilege a mint asked for, once it is known to be a privileged one. */
const privilege = ({
  isService,
  assignedToAnother,
}: {
  isService: boolean;
  assignedToAnother: boolean;
}): ApiKeyAdminRequiredAction => {
  if (isService) return "create-service-key";
  if (assignedToAnother) return "assign-to-another-user";

  return "create-unowned-key";
};

/**
 * A key nobody owns defaults to org-wide ADMIN; one minted for somebody else is
 * capped by THEIR access. Both take real adminness. Ownerlessness is
 * {@link keyOwner}'s answer: `keyType` alone would wave a "personal" key past.
 */
const refuseNonAdminPrivilegedMint = async ({
  app,
  caller,
  organizationId,
  isService,
  assignedToUserId,
}: {
  app: ApiKeyApi;
  caller: ApiKeyRestCaller;
  organizationId: string;
  isService: boolean;
  assignedToUserId?: string | undefined;
}): Promise<void> => {
  const assignedToAnother = !isService && !!assignedToUserId && assignedToUserId !== caller.userId;
  const owner = keyOwner({ isService, assignedToUserId, callerUserId: caller.userId });

  if (owner !== null && !assignedToAnother) return;
  if (await callerIsAdmin({ app, caller, organizationId })) return;

  throw new ApiKeyAdminRequiredError(privilege({ isService, assignedToAnother }));
};

export const apiKeyRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<ApiKeyApi>;
}> = defineRestRouter(ApiKeyApi)
  .withNamespace("api-keys")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  // The route policy is organization:view for the caller's OWN keys. The
  // org-wide listing a service credential receives is a different disclosure
  // (every key in the organization), so that branch additionally requires
  // organization:manage, which the application checks.
  .get("/", "listApiKeys")
  .withPermission("organization:view")
  .withOutput(apiKeyRestListSchema)
  .withDocs({
    tags: API_KEY_TAGS,
    summary: "List API keys",
    description:
      "List all API keys owned by the authenticated user in this organization. Requires organization:view permission.",
    errors: [
      INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions (requires organization:view)" },
    ],
  })
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, scope }, caller) => {
    const rows = await app.listForCaller(credentialCheck(caller, scope.id));

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
  })

  .post("/", "createApiKey")
  .withInput(apiKeyRestCreateSchema)
  .withPermission("organization:manage")
  .withOutput(apiKeyRestMintedSchema)
  .withStatus(201)
  .withDocs({
    tags: API_KEY_TAGS,
    summary: "Create an API key",
    description:
      'Create a new API key. For service keys, pass keyType:"service". Optionally scope to specific projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId to mint the key for another member, and permissionMode:"restricted" with a permissions list to grant exactly those permissions. Minting a service key or a key for another member requires organization admin rights. The plaintext token is returned once — store it securely.',
    errors: [
      INVALID_TOKEN,
      {
        status: 403,
        description:
          "Requested binding exceeds the creator's own permissions, or the scope does not belong to this organization (api_key_scope_violation); a service key or a key for another member was requested without organization admin rights (api_key_admin_required)",
      },
      {
        status: 422,
        description:
          "Validation error, for example a missing name or empty bindings (validation_error), or a name LangWatch reserves for its own keys (api_key_reserved_name)",
      },
    ],
  })
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) => {
    const isService = input.keyType === "service";

    await refuseNonAdminPrivilegedMint({
      app,
      caller,
      organizationId: scope.id,
      isService,
      assignedToUserId: input.assignedToUserId,
    });

    const result = await app.create({
      name: input.name,
      description: input.description,
      userId: keyOwner({
        isService,
        assignedToUserId: input.assignedToUserId,
        callerUserId: caller.userId,
      }),
      createdByUserId: caller.userId,
      organizationId: scope.id,
      expiresAt: input.expiresAt,
      permissionMode: input.permissionMode,
      permissions: input.permissions,
      bindings: requestedBindings({
        isService,
        bindings: input.bindings,
        projectIds: input.projectIds,
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
  })

  .get("/:apiKeyId", "getApiKey")
  .withParams(apiKeyRestParamsSchema)
  .withPermission("organization:view")
  .withOutput(apiKeyRestDetailSchema)
  .withDocs({
    tags: API_KEY_TAGS,
    summary: "Get an API key",
    description:
      "Read one API key by id, including its role bindings, permission mode and explicit permissions. Returns your own keys; organization admins may read any key in the organization. The secret is never returned. An id that does not exist, belongs to another organization, or belongs to another member all answer 404 api_key_not_found, so the response cannot be used to probe for keys.",
    errors: [
      INVALID_TOKEN,
      { status: 403, description: "Insufficient permissions (requires organization:view)" },
      { status: 404, description: "API key not found (api_key_not_found)" },
    ],
  })
  // Reading one key by id names a person, so it leaves a trail: the runtime
  // writes the row from the actor, the id in the path and the organization
  // the door resolved.
  .withAudit("management.api-key.read")
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) =>
    detailOf(
      await app.getByIdForCaller({
        id: input.apiKeyId,
        organizationId: scope.id,
        callerUserId: caller.userId,
        callerCanReadAnyKey: await callerCanReadAnyKey({
          app,
          caller,
          organizationId: scope.id,
        }),
      }),
    ),
  )

  .patch("/:apiKeyId", "updateApiKey")
  .withParams(apiKeyRestParamsSchema)
  .withInput(apiKeyRestUpdateSchema)
  .withPermission("organization:manage")
  .withOutput(apiKeyRestDetailSchema)
  .withDocs({
    tags: API_KEY_TAGS,
    summary: "Update an API key",
    description:
      "Update an API key's name, description, permission mode, permissions or bindings. Every field is optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns. You may update your own keys; organization admins may update any key in the organization. Bindings can never exceed the access of the member the key belongs to. The token itself never changes.",
    errors: [
      INVALID_TOKEN,
      {
        status: 403,
        description:
          "Insufficient permissions (requires organization:manage), the requested binding exceeds the key owner's own permissions, or the scope does not belong to this organization (api_key_scope_violation)",
      },
      { status: 404, description: "API key not found, or not yours to edit (api_key_not_found)" },
      { status: 409, description: "API key is already revoked (api_key_already_revoked)" },
      {
        status: 422,
        description:
          "Validation error, for example restricted mode without a permissions list (validation_error)",
      },
    ],
  })
  .withAudit("management.api-key.update")
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) => {
    const isAdmin = await callerIsAdmin({ app, caller, organizationId: scope.id });

    await app.updateAsCaller({
      id: input.apiKeyId,
      callerUserId: caller.userId,
      callerIsAdmin: isAdmin,
      organizationId: scope.id,
      name: input.name,
      description: input.description,
      permissionMode: input.permissionMode,
      permissions: input.permissions,
      bindings: input.bindings,
    });

    // Read back through the same path GET serves, so the two can never describe
    // the key differently. The route already demanded organization:manage, so
    // adminness alone decides the ownership branch.
    return detailOf(
      await app.getByIdForCaller({
        id: input.apiKeyId,
        organizationId: scope.id,
        callerUserId: caller.userId,
        callerCanReadAnyKey: isAdmin,
      }),
    );
  })

  .delete("/:apiKeyId", "revokeApiKey")
  .withParams(apiKeyRestParamsSchema)
  .withPermission("organization:manage")
  .withOutput(apiKeyRestRevokedSchema)
  .withDocs({
    tags: API_KEY_TAGS,
    summary: "Revoke an API key",
    description:
      "Revoke (soft-delete) an API key. Revoked keys can no longer authenticate. Requires organization:manage permission.",
    errors: [
      INVALID_TOKEN,
      {
        status: 403,
        description:
          "Not authorized to revoke this API key, which belongs to another member (api_key_not_owned)",
      },
      { status: 404, description: "API key not found (api_key_not_found)" },
      { status: 409, description: "API key is already revoked (api_key_already_revoked)" },
    ],
  })
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) => {
    // Real adminness, so revoke() can enforce its owner-only path: without
    // this, any organization:manage holder could revoke anyone's key.
    await app.revoke({
      id: input.apiKeyId,
      callerUserId: caller.userId,
      callerIsAdmin: await callerIsAdmin({ app, caller, organizationId: scope.id }),
      organizationId: scope.id,
    });

    return { success: true };
  })

  .build();
