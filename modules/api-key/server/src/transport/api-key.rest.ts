/**
 * `/api/api-keys` — the organization's own credentials, behind an organization
 * key. The door resolves the organization; the credential arrives as a bound
 * fact, because two questions here are asked of the KEY as well as the member.
 */
import {
  ApiKeyAdminRequiredError,
  ApiKeyApi,
  ApiKeyNotFoundError,
  ApiKeyNotOwnedError,
  ApiKeyPermissionDeniedError,
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
} from "@langwatch/api/rest";
import { z } from "zod";

import {
  CREATE_API_KEY,
  GET_API_KEY,
  LIST_API_KEYS,
  REVOKE_API_KEY,
  UPDATE_API_KEY,
} from "../rules/api-key-openapi.rules.ts";

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
  const assignedToAnother =
    !isService && !!assignedToUserId && assignedToUserId !== caller.userId;
  const owner = keyOwner({ isService, assignedToUserId, callerUserId: caller.userId });

  if (owner !== null && !assignedToAnother) return;
  if (await callerIsAdmin({ app, caller, organizationId })) return;

  throw new ApiKeyAdminRequiredError(privilege({ isService, assignedToAnother }));
};

export const apiKeyRest = defineRestRouter(ApiKeyApi)
  .withNamespace("api-keys")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  // The route policy is organization:view for the caller's OWN keys. The
  // org-wide listing a service credential receives is a different disclosure
  // (every key in the organization), so that branch additionally requires
  // organization:manage in the handler.
  .get("/", "listApiKeys")
  .withPermission("organization:view")
  .withOutput(apiKeyRestListSchema)
  .withDocs(LIST_API_KEYS)
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, scope }, caller) => {
    if (!caller.userId) {
      const canManage = await app.credentialCanManageOrganization(
        credentialCheck(caller, scope.id),
      );

      if (!canManage) throw new ApiKeyPermissionDeniedError("organization:manage");
    }

    const rows = caller.userId
      ? await app.list({ userId: caller.userId, organizationId: scope.id })
      : await app.listAll({ organizationId: scope.id });

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
  .withDocs(CREATE_API_KEY)
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

  .get("/:id", "getApiKey")
  .withParams(apiKeyRestParamsSchema)
  .withPermission("organization:view")
  .withOutput(apiKeyRestDetailSchema)
  .withDocs(GET_API_KEY)
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) =>
    detailOf(
      await app.getByIdForCaller({
        id: input.id,
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

  .patch("/:id", "updateApiKey")
  .withParams(apiKeyRestParamsSchema)
  .withInput(apiKeyRestUpdateSchema)
  .withPermission("organization:manage")
  .withOutput(apiKeyRestDetailSchema)
  .withDocs(UPDATE_API_KEY)
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) => {
    const isAdmin = await callerIsAdmin({ app, caller, organizationId: scope.id });

    try {
      await app.update({
        id: input.id,
        callerUserId: caller.userId,
        callerIsAdmin: isAdmin,
        organizationId: scope.id,
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

    // Read back through the same path GET serves, so the two can never describe
    // the key differently. The route already demanded organization:manage, so
    // adminness alone decides the ownership branch.
    return detailOf(
      await app.getByIdForCaller({
        id: input.id,
        organizationId: scope.id,
        callerUserId: caller.userId,
        callerCanReadAnyKey: isAdmin,
      }),
    );
  })

  .delete("/:id", "revokeApiKey")
  .withParams(apiKeyRestParamsSchema)
  .withPermission("organization:manage")
  .withOutput(apiKeyRestRevokedSchema)
  .withDocs(REVOKE_API_KEY)
  .withMiddleware(apiKeyRestCredential)
  .handle(async ({ app, input, scope }, caller) => {
    // Real adminness, so revoke() can enforce its owner-only path: without
    // this, any organization:manage holder could revoke anyone's key.
    await app.revoke({
      id: input.id,
      callerUserId: caller.userId,
      callerIsAdmin: await callerIsAdmin({ app, caller, organizationId: scope.id }),
      organizationId: scope.id,
    });

    return { success: true };
  })

  .build();
