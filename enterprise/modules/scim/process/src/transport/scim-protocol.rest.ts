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
import {
  defineRestMiddleware,
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  type DocumentedRouteResponse,
  type RestProtocolProducer,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import {
  ScimApi,
  scimGroupSchema,
  scimListResponseSchema,
  scimResourceTypeSchema,
  scimSchemaDefinitionSchema,
  scimServiceProviderConfigSchema,
  scimUserSchema,
} from "@langwatch/enterprise-scim-contract";
import { z } from "zod";

import { scimRefusalDocument } from "../rules/scim-refusal.rules.ts";

const SCIM_MEDIA_TYPE = "application/scim+json";
const MAX_PAGE_SIZE = 100;
const SCIM_TAGS = ["SCIM"] as const;

const UNAUTHORIZED = {
  status: 401,
  description:
    "The Authorization header is missing, is not a bearer token, or names a token this deployment does not know.",
} as const;

const PLAN_NOT_ENTITLED = {
  status: 403,
  description:
    "The token is valid but the organization's plan no longer includes SCIM provisioning. Entitlement is checked on every call, so a directory connection stops the moment the Enterprise plan lapses.",
} as const;

const INVALID_BODY = {
  status: 400,
  description:
    "The request body is not JSON, or does not match the SCIM schema for this operation.",
} as const;

const USER_NOT_FOUND = {
  status: 404,
  description: "No such member in this organization.",
} as const;

const GROUP_NOT_FOUND = {
  status: 404,
  description: "No such group in this organization.",
} as const;

/** A 204 carries no body, so it publishes no media type either. */
const DEPROVISIONED: Record<number, DocumentedRouteResponse> = {
  204: { description: "Deprovisioned. No body.", content: {} },
};

/** `documentedResponses()`'s generated block with the SCIM-specific sentence in place of its generic reason phrase. */
function scimAnswer(
  status: number,
  description: string,
  schema: z.ZodType,
): Record<number, DocumentedRouteResponse> {
  return { [status]: { ...documentedResponses({ [status]: schema })[status], description } };
}

/** Every answer on the twelve provisioning routes is the protocol's own document. */
const SCIM_ANSWER = [SCIM_MEDIA_TYPE] as const;

/** Discovery answers plain JSON, as it always has. */
const DISCOVERY_ANSWER = ["application/json"] as const;

const DISCOVERY_IS_PRE_CREDENTIAL =
  "SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists";

const BEARER_IS_THE_WHOLE_GATE =
  "a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides";

/**
 * The directory connection the presented token belongs to, when it belongs
 * to one — bound from the SCIM door's own resolution (§8: a module fact
 * reads the door's credential back, it never re-verifies the bearer itself).
 */
export const scimRestCredential = defineRestMiddleware(
  "scimRestCredential",
  z.object({ connectionId: z.string().nullable() }),
);

const idParams = z.object({ id: z.string().min(1) });

/** A query value as main read it: the first one, where the parameter is repeated. */
function firstValue(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

function queryText(description: string) {
  return z.preprocess(firstValue, z.string()).optional().describe(description);
}

/**
 * A page bound, published as the integer main documented and read leniently:
 * a value that is not a positive integer is the default rather than a refusal,
 * because an identity provider that sends one should still get its page.
 */
function pageBound({
  fallback,
  max,
  description,
}: {
  fallback: number;
  max: number;
  description: string;
}) {
  return z
    .preprocess((raw) => {
      const first = firstValue(raw);
      const value = Number.parseInt(typeof first === "string" ? first : "", 10);

      return Math.min(Number.isInteger(value) && value > 0 ? value : fallback, max);
    }, z.number().int().max(max))
    .default(fallback)
    .describe(description);
}

const listQuery = z.object({
  filter: queryText(
    'A SCIM filter. Only `attribute eq "..."` is understood; any other expression is refused.',
  ),
  startIndex: pageBound({
    fallback: 1,
    max: Number.MAX_SAFE_INTEGER,
    description:
      "1-based index of the first resource to return. Anything that does not parse as a positive integer is read as 1.",
  }),
  count: pageBound({
    fallback: MAX_PAGE_SIZE,
    max: MAX_PAGE_SIZE,
    description:
      "How many resources to return, capped at 100 (the `filter.maxResults` ServiceProviderConfig publishes). Anything that does not parse as a positive integer is read as 100, and anything above 100 is served as 100.",
  }),
});

const excludedAttributesQuery = z.object({
  excludedAttributes: queryText(
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
 * Every refusal on the family, the door's included, in RFC 7644's own error
 * document: an identity provider reads `status` and `detail`, and a shape it
 * cannot parse reads as an outage.
 */
const scimRefusal: RestProtocolRefusal = ({ failure, response }) => {
  const document = scimRefusalDocument(failure);

  return response.write({
    status: Number(document.status),
    mediaType: SCIM_MEDIA_TYPE,
    body: JSON.stringify(document),
  });
};

const SCIM_WIRE =
  "SCIM 2.0 is RFC 7644's wire, read by identity providers: its documents and its errors are the protocol's, not the platform's envelope";

/** Every answer on the twelve provisioning routes is the protocol's own document. */
const SCIM_PROTOCOL = { produces: SCIM_ANSWER, because: SCIM_WIRE, refusal: scimRefusal } as const;

/** Discovery answers plain JSON, as it always has, and refuses as the rest of the family does. */
const DISCOVERY_PROTOCOL = {
  produces: DISCOVERY_ANSWER,
  because: SCIM_WIRE,
  refusal: scimRefusal,
} as const;

function scimJson({
  response,
  data,
  status = 200,
}: {
  response: RestProtocolProducer<typeof SCIM_ANSWER>;
  data: unknown;
  status?: 200 | 201;
}) {
  return response.write({ status, mediaType: SCIM_MEDIA_TYPE, body: JSON.stringify(data) });
}

function discoveryJson({
  response,
  data,
}: {
  response: RestProtocolProducer<typeof DISCOVERY_ANSWER>;
  data: unknown;
}) {
  return response.write({ status: 200, mediaType: "application/json", body: JSON.stringify(data) });
}

/** The bodyless answer a deprovisioning gives. */
function deprovisioned({ response }: { response: RestProtocolProducer<typeof SCIM_ANSWER> }) {
  return response.write({ status: 204, mediaType: SCIM_MEDIA_TYPE, body: null });
}

function excludesMembers(raw: string | undefined): boolean {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes("members");
}

export const scimProtocolRest = defineRestRouter(ScimApi)
  .withNamespace("scim")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("scimToken")
  .withAddressing("v1-in-path", { generation: "v2" })

  // ── Discovery ─────────────────────────────────────────────────────────────

  .get("/ServiceProviderConfig", "scimGetServiceProviderConfig")
  .withAccess(publicRoute({ reason: DISCOVERY_IS_PRE_CREDENTIAL }))
  .withResponse("protocol", DISCOVERY_PROTOCOL)
  .withDocs({
    summary: "Get the SCIM service provider configuration",
    description:
      "What this SCIM implementation supports (RFC 7643 section 5), which is how an identity provider decides what it may call: PATCH and filtering are supported, bulk operations, sorting, ETags and password change are not. Unauthenticated, because a provider reads it while being configured, before a token exists.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The supported capabilities.", scimServiceProviderConfigSchema),
  })
  .handle(({ response }) => discoveryJson({ response, data: SERVICE_PROVIDER_CONFIG }))

  .get("/ResourceTypes", "scimListResourceTypes")
  .withAccess(publicRoute({ reason: DISCOVERY_IS_PRE_CREDENTIAL }))
  .withResponse("protocol", DISCOVERY_PROTOCOL)
  .withDocs({
    summary: "List the SCIM resource types",
    description:
      "The resources this service provisions, User and Group, each naming the endpoint and the schema URN that serves it (RFC 7643 section 6). Unauthenticated, like the rest of SCIM discovery.",
    tags: SCIM_TAGS,
    responses: scimAnswer(
      200,
      "The User and Group resource types.",
      scimListResponseSchema(scimResourceTypeSchema),
    ),
  })
  .handle(({ response }) => discoveryJson({ response, data: RESOURCE_TYPES_DOCUMENT }))

  .get("/Schemas", "scimListSchemas")
  .withAccess(publicRoute({ reason: DISCOVERY_IS_PRE_CREDENTIAL }))
  .withResponse("protocol", DISCOVERY_PROTOCOL)
  .withDocs({
    summary: "List the SCIM resource schemas",
    description:
      "The attribute definitions for the User and Group resources (RFC 7643 section 7), which an identity provider reads to build its attribute mapping. A LangWatch group is an access group: its membership drives role bindings, and it is not a team. Unauthenticated, like the rest of SCIM discovery.",
    tags: SCIM_TAGS,
    responses: scimAnswer(
      200,
      "The User and Group schema definitions.",
      scimListResponseSchema(scimSchemaDefinitionSchema),
    ),
  })
  .handle(({ response }) => discoveryJson({ response, data: SCIM_SCHEMAS_DOCUMENT }))

  // ── Users ─────────────────────────────────────────────────────────────────

  .get("/Users", "scimListUsers")
  .withQuery(listQuery)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "List provisioned users",
    description:
      'The members of the organization the token belongs to, as SCIM users. Two filter expressions are understood: `userName eq "someone@example.com"`, matched against the member\'s email without regard to case, and `externalId eq "..."`, matched against the identifier the presented token\'s own directory connection pushed. Any other filter is refused.',
    tags: SCIM_TAGS,
    responses: scimAnswer(
      200,
      "A page of provisioned users.",
      scimListResponseSchema(scimUserSchema),
    ),
    errors: [UNAUTHORIZED, PLAN_NOT_ENTITLED],
  })
  .handle(async ({ app, input, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.listUsers({
        organizationId: scope.id,
        connectionId,
        filter: input.filter,
        startIndex: input.startIndex,
        count: input.count,
      }),
    }),
  )

  .post("/Users", "scimCreateUser")
  .withRawBody("text", { mediaType: SCIM_MEDIA_TYPE })
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Provision a user",
    description:
      "Adds a member to the organization, creating the LangWatch account when the email is new. Someone who already has an account is added and reactivated rather than refused, which is what lets a directory sync be re-run without special-casing the people it already knows. New members join with the MEMBER role at organization scope. `costCenter` on the enterprise user extension assigns their department, creating that department on first use.",
    tags: SCIM_TAGS,
    responses: scimAnswer(201, "The provisioned user.", scimUserSchema),
    errors: [
      INVALID_BODY,
      UNAUTHORIZED,
      PLAN_NOT_ENTITLED,
      {
        status: 409,
        description: "A member with this userName already exists in the organization.",
      },
    ],
  })
  .handle(async ({ app, raw, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.createUser({
        organizationId: scope.id,
        connectionId,
        body: raw,
      }),
      status: 201,
    }),
  )

  .get("/Users/:id", "scimGetUser")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Get a provisioned user",
    description:
      "Reads one member of the organization the token belongs to. An id that is not a member answers 404, whether or not it names a LangWatch account elsewhere.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The user.", scimUserSchema),
    errors: [UNAUTHORIZED, PLAN_NOT_ENTITLED, USER_NOT_FOUND],
  })
  .handle(async ({ app, input, scope, response }) =>
    scimJson({ response, data: await app.getUser({ id: input.id, organizationId: scope.id }) }),
  )

  .put("/Users/:id", "scimReplaceUser")
  .withParams(idParams)
  .withRawBody("text", { mediaType: SCIM_MEDIA_TYPE })
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Replace a provisioned user",
    description:
      "Replaces the member's attributes with the body. It is a whole-resource write, so an attribute the identity provider leaves out is reset rather than kept: omitting `active` reactivates the member. Send PATCH instead to change one attribute.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The updated user.", scimUserSchema),
    errors: [INVALID_BODY, UNAUTHORIZED, PLAN_NOT_ENTITLED, USER_NOT_FOUND],
  })
  .handle(async ({ app, input, raw, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.replaceUser({
        id: input.id,
        organizationId: scope.id,
        connectionId,
        body: raw,
      }),
    }),
  )

  .patch("/Users/:id", "scimPatchUser")
  .withParams(idParams)
  .withRawBody("text", { mediaType: SCIM_MEDIA_TYPE })
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Update a provisioned user",
    description:
      "Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `replace` of `active` (deactivating or reactivating the account), of `userName`, and of `name.givenName` / `name.familyName`, written either as an operation path or as keys inside a value object; and `add`, `replace` or `remove` of the enterprise `costCenter`, which reassigns the member's department. `replace`, `add` and `remove` are the only operation names understood, read without regard to case, so the capitalized `Replace` that Entra ID writes is accepted; any other name, or a missing or non-string one, is rejected with a 400. An understood operation aimed at anything not listed above is accepted and changes nothing.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The updated user.", scimUserSchema),
    errors: [INVALID_BODY, UNAUTHORIZED, PLAN_NOT_ENTITLED, USER_NOT_FOUND],
  })
  .handle(async ({ app, input, raw, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.updateUser({
        id: input.id,
        organizationId: scope.id,
        connectionId,
        body: raw,
      }),
    }),
  )

  .delete("/Users/:id", "scimDeleteUser")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Deprovision a user",
    description:
      "Removes the member from the organization, drops the role bindings they held there, and deactivates their account. The LangWatch user record itself is kept, so past traces, evaluations and audit entries stay attributable.",
    tags: SCIM_TAGS,
    responses: DEPROVISIONED,
    errors: [UNAUTHORIZED, PLAN_NOT_ENTITLED, USER_NOT_FOUND],
  })
  .handle(async ({ app, input, scope, response }, { connectionId }) => {
    await app.deleteUser({ id: input.id, organizationId: scope.id, connectionId });

    return deprovisioned({ response });
  })

  // ── Groups ────────────────────────────────────────────────────────────────

  .get("/Groups", "scimListGroups")
  .withQuery(groupListQuery)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "List provisioned groups",
    description:
      'The organization\'s SCIM-provisioned access groups. Groups created in LangWatch itself are not listed: the directory sees what it provisioned, and nothing else. One filter expression is understood, `displayName eq "Engineering"`, matched without regard to case.',
    tags: SCIM_TAGS,
    responses: scimAnswer(
      200,
      "A page of provisioned groups.",
      scimListResponseSchema(scimGroupSchema),
    ),
    errors: [UNAUTHORIZED, PLAN_NOT_ENTITLED],
  })
  .handle(async ({ app, input, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.listGroups({
        organizationId: scope.id,
        connectionId,
        filter: input.filter,
        startIndex: input.startIndex,
        count: input.count,
        excludeMembers: excludesMembers(input.excludedAttributes),
      }),
    }),
  )

  .post("/Groups", "scimCreateGroup")
  .withRawBody("text", { mediaType: SCIM_MEDIA_TYPE })
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Provision a group",
    description:
      "Creates an access group. Members are given as LangWatch user ids, the same ids the Users endpoints return; an id that is not a member of the organization is skipped rather than failing the call, so a group can be provisioned before everyone in it is. Granting the group access is a separate step: a group carries no permissions until a role binding is created for it.",
    tags: SCIM_TAGS,
    responses: scimAnswer(201, "The provisioned group.", scimGroupSchema),
    errors: [
      INVALID_BODY,
      UNAUTHORIZED,
      PLAN_NOT_ENTITLED,
      {
        status: 409,
        description:
          "A provisioned group with this displayName already exists in the organization.",
      },
    ],
  })
  .handle(async ({ app, raw, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.createGroup({
        organizationId: scope.id,
        connectionId,
        body: raw,
      }),
      status: 201,
    }),
  )

  .get("/Groups/:id", "scimGetGroup")
  .withParams(idParams)
  .withQuery(excludedAttributesQuery)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Get a provisioned group",
    description:
      "Reads one provisioned group and its members. A group that exists but was created in LangWatch rather than provisioned is not readable here.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The group.", scimGroupSchema),
    errors: [UNAUTHORIZED, PLAN_NOT_ENTITLED, GROUP_NOT_FOUND],
  })
  .handle(async ({ app, input, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.getGroup({
        externalScimId: input.id,
        organizationId: scope.id,
        connectionId,
        excludeMembers: excludesMembers(input.excludedAttributes),
      }),
    }),
  )

  .put("/Groups/:id", "scimReplaceGroup")
  .withParams(idParams)
  .withRawBody("text", { mediaType: SCIM_MEDIA_TYPE })
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Replace a provisioned group",
    description:
      "Replaces the group's display name and its membership with the body. Membership is a whole-resource write: a member absent from `members` is removed from the group, and omitting `members` empties it. Role bindings granted to the group are untouched.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The updated group.", scimGroupSchema),
    errors: [INVALID_BODY, UNAUTHORIZED, PLAN_NOT_ENTITLED, GROUP_NOT_FOUND],
  })
  .handle(async ({ app, input, raw, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.replaceGroup({
        externalScimId: input.id,
        organizationId: scope.id,
        connectionId,
        body: raw,
      }),
    }),
  )

  .patch("/Groups/:id", "scimPatchGroup")
  .withParams(idParams)
  .withRawBody("text", { mediaType: SCIM_MEDIA_TYPE })
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Update a provisioned group",
    description:
      "Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `add` of members, `remove` of members (named by a value filter on the path, as Entra ID writes it, or in the operation value), `replace` of `displayName`, and `replace` of the whole member list. `replace`, `add` and `remove` are the only operation names understood, read without regard to case, so the capitalized `Add` / `Remove` that Entra ID writes are accepted; any other name, or a missing or non-string one, is rejected with a 400. An `add` or a `remove` aimed at anything other than members is accepted and changes nothing. A `replace` that is not a `displayName` rename is treated as a replacement of the whole member list, so one that carries no members empties the group.",
    tags: SCIM_TAGS,
    responses: scimAnswer(200, "The updated group.", scimGroupSchema),
    errors: [INVALID_BODY, UNAUTHORIZED, PLAN_NOT_ENTITLED, GROUP_NOT_FOUND],
  })
  .handle(async ({ app, input, raw, scope, response }, { connectionId }) =>
    scimJson({
      response,
      data: await app.updateGroup({
        externalScimId: input.id,
        organizationId: scope.id,
        connectionId,
        body: raw,
      }),
    }),
  )

  .delete("/Groups/:id", "scimDeleteGroup")
  .withParams(idParams)
  .withAccess(anyAuthenticated({ reason: BEARER_IS_THE_WHOLE_GATE }))
  .withMiddleware(scimRestCredential)
  .withResponse("protocol", SCIM_PROTOCOL)
  .withDocs({
    summary: "Deprovision a group",
    description:
      "Deletes the group along with its memberships and every role binding granted through it, so the access it carried is revoked with it. The members themselves keep their organization membership and any access they hold directly.",
    tags: SCIM_TAGS,
    responses: DEPROVISIONED,
    errors: [UNAUTHORIZED, PLAN_NOT_ENTITLED, GROUP_NOT_FOUND],
  })
  .handle(async ({ app, input, scope, response }, { connectionId }) => {
    await app.deleteGroup({ externalScimId: input.id, organizationId: scope.id, connectionId });

    return deprovisioned({ response });
  })
  .build();
