// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM 2.0 protocol family, at `/api/scim/v2/**`.
 *
 * `/api/scim/v2` IS the SCIM 2.0 contract: the generation is the protocol
 * version, so the routes answer exactly where an identity provider is already
 * configured to reach them, with no dated namespace beside them.
 *
 * Three of its routes are DISCOVERY and carry no credential at all: a provider
 * negotiates capabilities before a token exists, so `ServiceProviderConfig`,
 * `ResourceTypes` and `Schemas` answer anonymously. The other twelve are gated
 * by the bearer the organization minted — the `scimToken` door, which is also
 * where a plan that no longer includes directory sync becomes a 403 rather
 * than a 401, so an entitled customer with a bad token and an unentitled one
 * with a good token get different answers.
 *
 * @see enterprise/modules/scim/specs/scim.feature
 */
import { anyAuthenticated, publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestErrorHandler } from "@langwatch/api/rest";
import {
  ScimApi,
  ScimProtocolError,
  scimCreateGroupRequestSchema,
  scimCreateUserRequestSchema,
  scimPatchRequestSchema,
  scimReplaceGroupRequestSchema,
} from "@langwatch/enterprise-scim-contract";
import { z } from "zod";

import {
  CREATE_GROUP,
  CREATE_USER,
  DELETE_GROUP,
  DELETE_USER,
  GET_GROUP,
  GET_SERVICE_PROVIDER_CONFIG,
  GET_USER,
  LIST_GROUPS,
  LIST_RESOURCE_TYPES,
  LIST_SCHEMAS,
  LIST_USERS,
  PATCH_GROUP,
  PATCH_USER,
  REPLACE_GROUP,
  REPLACE_USER,
} from "../rules/scim-openapi.rules.ts";

const SCIM_MEDIA_TYPE = "application/scim+json";
const MAX_PAGE_SIZE = 100;

/** Every answer on the twelve provisioning routes is the protocol's own document. */
const SCIM_ANSWER = [SCIM_MEDIA_TYPE] as const;

/** Discovery answers plain JSON, as it always has. */
const DISCOVERY_ANSWER = ["application/json"] as const;

const DISCOVERY_IS_PRE_CREDENTIAL =
  "SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists";

const BEARER_IS_THE_WHOLE_GATE =
  "a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides";

const idParams = z.object({ id: z.string().min(1) });

/**
 * The three query parameters a collection reads, each optional and each read
 * leniently: a value that is not a positive integer is the documented default
 * rather than a refusal, because an identity provider that sends one should
 * still get its page.
 */
const listQuery = z.object({
  filter: z
    .string()
    .optional()
    .describe('A SCIM filter. Only `attribute eq "..."` is applied; anything else is ignored.'),
  startIndex: z
    .string()
    .optional()
    .describe(
      "1-based index of the first resource to return. Anything that does not parse as a positive integer is read as 1.",
    ),
  count: z
    .string()
    .optional()
    .describe(
      "How many resources to return, capped at 100 (the `filter.maxResults` ServiceProviderConfig publishes). Anything that does not parse as a positive integer is read as 100, and anything above 100 is served as 100.",
    ),
});

const excludedAttributesQuery = z.object({
  excludedAttributes: z
    .string()
    .optional()
    .describe(
      "Comma-separated attribute names to leave out of the response. Only `members` is honoured, and it is what lets a directory page through groups without pulling every membership.",
    ),
});

const groupListQuery = z.object({ ...listQuery.shape, ...excludedAttributesQuery.shape });

/** The two schema documents this surface publishes, verbatim. */
const SCIM_SCHEMAS_DOCUMENT = {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults: 2,
  itemsPerPage: 2,
  startIndex: 1,
  Resources: [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: "urn:ietf:params:scim:schemas:core:2.0:User",
      name: "User",
      description: "User Account",
      attributes: [
        {
          name: "userName",
          type: "string",
          multiValued: false,
          required: true,
          caseExact: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
        {
          name: "name",
          type: "complex",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          subAttributes: [
            {
              name: "givenName",
              type: "string",
              multiValued: false,
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
            {
              name: "familyName",
              type: "string",
              multiValued: false,
              required: false,
              mutability: "readWrite",
              returned: "default",
            },
          ],
        },
        {
          name: "emails",
          type: "complex",
          multiValued: true,
          required: false,
          mutability: "readWrite",
          returned: "default",
        },
        {
          name: "active",
          type: "boolean",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
        },
      ],
      meta: {
        resourceType: "Schema",
        location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User",
      },
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: "urn:ietf:params:scim:schemas:core:2.0:Group",
      name: "Group",
      description: "Group (maps to a LangWatch access group)",
      attributes: [
        {
          name: "displayName",
          type: "string",
          multiValued: false,
          required: true,
          caseExact: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "members",
          type: "complex",
          multiValued: true,
          required: false,
          mutability: "readWrite",
          returned: "default",
          subAttributes: [
            {
              name: "value",
              type: "string",
              multiValued: false,
              required: true,
              mutability: "immutable",
              returned: "default",
              description: "The user ID of the group member",
            },
            {
              name: "display",
              type: "string",
              multiValued: false,
              required: false,
              mutability: "readOnly",
              returned: "default",
            },
          ],
        },
      ],
      meta: {
        resourceType: "Schema",
        location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group",
      },
    },
  ],
};

const SERVICE_PROVIDER_CONFIG = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  documentationUri: "https://docs.langwatch.ai/scim",
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: MAX_PAGE_SIZE },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: "oauthbearertoken",
      name: "OAuth Bearer Token",
      description: "Authentication scheme using the OAuth Bearer Token standard",
    },
  ],
};

const RESOURCE_TYPES_DOCUMENT = {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults: 2,
  itemsPerPage: 2,
  startIndex: 1,
  Resources: [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/api/scim/v2/Users",
      schema: "urn:ietf:params:scim:schemas:core:2.0:User",
      meta: { resourceType: "ResourceType", location: "/api/scim/v2/ResourceTypes/User" },
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "Group",
      name: "Group",
      endpoint: "/api/scim/v2/Groups",
      schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
      meta: { resourceType: "ResourceType", location: "/api/scim/v2/ResourceTypes/Group" },
    },
  ],
};

/**
 * The family's own refusals, in the protocol's own document. Exported because
 * the mount installs the family's error boundary and this is the wording the
 * module owns: the door raises these too, from `authenticateDirectory`.
 * Everything else leaves the family exactly as it did before — rethrown to the
 * process boundary rather than rendered here.
 */
export const scimProtocolErrorHandler: RestErrorHandler = (error) => {
  if (error instanceof ScimProtocolError) {
    return scimJson(error.response, Number(error.response.status));
  }

  throw error;
};

function scimJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": SCIM_MEDIA_TYPE },
  });
}

function scimError(status: number, detail: string): Response {
  return scimJson(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      detail,
    },
    status,
  );
}

function discoveryJson(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** The bodyless answer a deprovisioning gives. */
function deprovisioned(): Response {
  return new Response(null, { status: 204 });
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function pageSize(raw: string | undefined): number {
  return Math.min(positiveInteger(raw, MAX_PAGE_SIZE), MAX_PAGE_SIZE);
}

function excludesMembers(raw: string | undefined): boolean {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes("members");
}

/** The posted document, or nothing where the request did not carry JSON. */
async function posted(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const scimProtocolRest = defineRestRouter(ScimApi)
  .withNamespace("scim")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("scimToken")
  .withAddressing("v1-in-path", { generation: "v2" })

  // ── Discovery ─────────────────────────────────────────────────────────────

  .get("/ServiceProviderConfig", "scimGetServiceProviderConfig")
  .withAccess(publicRoute({ reason: DISCOVERY_IS_PRE_CREDENTIAL }))
  .withRawResponse({ produces: DISCOVERY_ANSWER })
  .withDocs(GET_SERVICE_PROVIDER_CONFIG)
  .handle(() => discoveryJson(SERVICE_PROVIDER_CONFIG))

  .get("/ResourceTypes", "scimListResourceTypes")
  .withAccess(publicRoute({ reason: DISCOVERY_IS_PRE_CREDENTIAL }))
  .withRawResponse({ produces: DISCOVERY_ANSWER })
  .withDocs(LIST_RESOURCE_TYPES)
  .handle(() => discoveryJson(RESOURCE_TYPES_DOCUMENT))

  .get("/Schemas", "scimListSchemas")
  .withAccess(publicRoute({ reason: DISCOVERY_IS_PRE_CREDENTIAL }))
  .withRawResponse({ produces: DISCOVERY_ANSWER })
  .withDocs(LIST_SCHEMAS)
  .handle(() => discoveryJson(SCIM_SCHEMAS_DOCUMENT))

  // ── Users ─────────────────────────────────────────────────────────────────

  .get("/Users", "scimListUsers")
  .withQuery(listQuery)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(LIST_USERS)
  .handle(async ({ app, input, scope }) =>
    scimJson(
      await app.listUsers({
        organizationId: scope.id,
        filter: input.filter,
        startIndex: positiveInteger(input.startIndex, 1),
        count: pageSize(input.count),
      }),
    ),
  )

  .post("/Users", "scimCreateUser")
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(CREATE_USER)
  .handle(async ({ app, scope, request }) => {
    const body = await posted(request);

    if (body === null) return scimError(400, "Invalid JSON in request body");

    const parsed = scimCreateUserRequestSchema.safeParse(body);

    if (!parsed.success) return scimError(400, parsed.error.message);

    return scimJson(
      await app.createUser({ organizationId: scope.id, request: parsed.data }),
      201,
    );
  })

  .get("/Users/:id", "scimGetUser")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(GET_USER)
  .handle(async ({ app, input, scope }) =>
    scimJson(await app.getUser({ id: input.id, organizationId: scope.id })),
  )

  .put("/Users/:id", "scimReplaceUser")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(REPLACE_USER)
  .handle(async ({ app, input, scope, request }) => {
    const body = await posted(request);

    if (body === null) return scimError(400, "Invalid JSON in request body");

    const parsed = scimCreateUserRequestSchema.safeParse(body);

    if (!parsed.success) return scimError(400, parsed.error.message);

    return scimJson(
      await app.replaceUser({ id: input.id, organizationId: scope.id, request: parsed.data }),
    );
  })

  .patch("/Users/:id", "scimPatchUser")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(PATCH_USER)
  .handle(async ({ app, input, scope, request }) => {
    const body = await posted(request);

    if (body === null) return scimError(400, "Invalid JSON in request body");

    const parsed = scimPatchRequestSchema.safeParse(body);

    if (!parsed.success) return scimError(400, parsed.error.message);

    return scimJson(
      await app.updateUser({
        id: input.id,
        organizationId: scope.id,
        patchRequest: parsed.data,
      }),
    );
  })

  .delete("/Users/:id", "scimDeleteUser")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(DELETE_USER)
  .handle(async ({ app, input, scope }) => {
    await app.deleteUser({ id: input.id, organizationId: scope.id });

    return deprovisioned();
  })

  // ── Groups ────────────────────────────────────────────────────────────────

  .get("/Groups", "scimListGroups")
  .withQuery(groupListQuery)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(LIST_GROUPS)
  .handle(async ({ app, input, scope }) =>
    scimJson(
      await app.listGroups({
        organizationId: scope.id,
        filter: input.filter,
        startIndex: positiveInteger(input.startIndex, 1),
        count: pageSize(input.count),
        excludeMembers: excludesMembers(input.excludedAttributes),
      }),
    ),
  )

  .post("/Groups", "scimCreateGroup")
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(CREATE_GROUP)
  .handle(async ({ app, scope, request }) => {
    const body = await posted(request);

    if (body === null) return scimError(400, "Invalid JSON");

    const parsed = scimCreateGroupRequestSchema.safeParse(body);

    if (!parsed.success) return scimError(400, parsed.error.message);

    return scimJson(
      await app.createGroup({ organizationId: scope.id, request: parsed.data }),
      201,
    );
  })

  .get("/Groups/:id", "scimGetGroup")
  .withParams(idParams)
  .withQuery(excludedAttributesQuery)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(GET_GROUP)
  .handle(async ({ app, input, scope }) =>
    scimJson(
      await app.getGroup({
        externalScimId: input.id,
        organizationId: scope.id,
        excludeMembers: excludesMembers(input.excludedAttributes),
      }),
    ),
  )

  .put("/Groups/:id", "scimReplaceGroup")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(REPLACE_GROUP)
  .handle(async ({ app, input, scope, request }) => {
    const body = await posted(request);

    if (body === null) return scimError(400, "Invalid JSON");

    const parsed = scimReplaceGroupRequestSchema.safeParse(body);

    if (!parsed.success) return scimError(400, parsed.error.message);

    return scimJson(
      await app.replaceGroup({
        externalScimId: input.id,
        organizationId: scope.id,
        request: parsed.data,
      }),
    );
  })

  .patch("/Groups/:id", "scimPatchGroup")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(PATCH_GROUP)
  .handle(async ({ app, input, scope, request }) => {
    const body = await posted(request);

    if (body === null) return scimError(400, "Invalid JSON");

    const parsed = scimPatchRequestSchema.safeParse(body);

    if (!parsed.success) return scimError(400, parsed.error.message);

    return scimJson(
      await app.updateGroup({
        externalScimId: input.id,
        organizationId: scope.id,
        patchRequest: parsed.data,
      }),
    );
  })

  .delete("/Groups/:id", "scimDeleteGroup")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withRawResponse({ produces: SCIM_ANSWER })
  .withDocs(DELETE_GROUP)
  .handle(async ({ app, input, scope }) => {
    await app.deleteGroup({ externalScimId: input.id, organizationId: scope.id });

    return deprovisioned();
  })
  .build();
