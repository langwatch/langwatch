// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The published documentation for the SCIM 2.0 provisioning surface.
 *
 * The reader here is an identity administrator wiring Okta, Entra ID or
 * OneLogin to LangWatch, so the descriptions say what this implementation
 * actually does rather than what SCIM allows. Filtering is the clearest case:
 * RFC 7644 defines a whole expression language, and this service parses
 * exactly one expression per collection. Documenting the language would
 * promise an equality filter on any attribute and send the reader looking for
 * a bug in their identity provider.
 *
 * Three things the older `DescribeRouteOptions` set carried are gone, because
 * the declaration now says them: the operation id is the second argument of
 * the route, the security requirement follows the family's declared door, and
 * the query parameters are the schemas the routes parse. What is left is the
 * prose and the answer shapes, which no declaration can derive.
 *
 * Request bodies stay absent. The write routes parse the body inside the
 * handler so a malformed document answers the protocol's own error rather than
 * a validation envelope, and each operation's description says which RFC 7643
 * resource it takes.
 */
import type { RestTransportDocs } from "@langwatch/api/rest";

const SCIM_MEDIA_TYPE = "application/scim+json";
const TAGS = ["SCIM"] as const;

const SCHEMA_URNS = {
  type: "array" as const,
  items: { type: "string" as const },
  description: "The SCIM schema URNs this resource conforms to.",
};

const RESOURCE_META = {
  type: "object" as const,
  properties: {
    resourceType: { type: "string" as const },
    created: { type: "string" as const, format: "date-time" },
    lastModified: { type: "string" as const, format: "date-time" },
  },
};

const DISCOVERY_META = {
  type: "object" as const,
  properties: {
    resourceType: { type: "string" as const },
    location: { type: "string" as const },
  },
};

const SUPPORTED_FLAG = {
  type: "object" as const,
  properties: { supported: { type: "boolean" as const } },
};

const SCIM_USER = {
  type: "object" as const,
  properties: {
    schemas: SCHEMA_URNS,
    id: {
      type: "string" as const,
      description:
        "The LangWatch user id. Use it as the resource id in later calls, and as a member value on a group.",
    },
    userName: {
      type: "string" as const,
      format: "email",
      description: "The member's email address, which is their login.",
    },
    name: {
      type: "object" as const,
      properties: {
        givenName: { type: "string" as const },
        familyName: { type: "string" as const },
      },
    },
    emails: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          value: { type: "string" as const, format: "email" },
          primary: { type: "boolean" as const },
          type: { type: "string" as const },
        },
      },
    },
    active: {
      type: "boolean" as const,
      description: "False once the account is deactivated.",
    },
    meta: RESOURCE_META,
  },
};

const SCIM_GROUP = {
  type: "object" as const,
  properties: {
    schemas: SCHEMA_URNS,
    id: { type: "string" as const, description: "The LangWatch group id." },
    displayName: { type: "string" as const },
    members: {
      type: "array" as const,
      description:
        "Omitted when the request excluded the members attribute. Each value is a LangWatch user id.",
      items: {
        type: "object" as const,
        properties: {
          value: { type: "string" as const },
          display: { type: "string" as const },
        },
      },
    },
    meta: RESOURCE_META,
  },
};

const RESOURCE_TYPE = {
  type: "object" as const,
  properties: {
    schemas: SCHEMA_URNS,
    id: { type: "string" as const },
    name: { type: "string" as const },
    endpoint: { type: "string" as const },
    schema: {
      type: "string" as const,
      description: "The URN of the schema this resource type is defined by.",
    },
    meta: DISCOVERY_META,
  },
};

const RESOURCE_SCHEMA = {
  type: "object" as const,
  properties: {
    schemas: SCHEMA_URNS,
    id: { type: "string" as const, description: "The schema URN." },
    name: { type: "string" as const },
    description: { type: "string" as const },
    attributes: {
      type: "array" as const,
      description: "The attribute definitions, in the shape RFC 7643 section 7 gives them.",
      items: { type: "object" as const },
    },
    meta: DISCOVERY_META,
  },
};

function listOf<T>(items: T) {
  return {
    type: "object" as const,
    properties: {
      schemas: SCHEMA_URNS,
      totalResults: {
        type: "integer" as const,
        description: "How many resources match, before pagination.",
      },
      startIndex: { type: "integer" as const },
      itemsPerPage: { type: "integer" as const },
      Resources: { type: "array" as const, items },
    },
  };
}

function scimResource<T>({ description, schema }: { description: string; schema: T }) {
  return { description, content: { [SCIM_MEDIA_TYPE]: { schema } } };
}

function discoveryResource<T>({ description, schema }: { description: string; schema: T }) {
  return { description, content: { "application/json": { schema } } };
}

/** The RFC 7644 error response carried by every SCIM refusal. */
function scimErrorResponse(description: string) {
  return {
    description,
    content: {
      [SCIM_MEDIA_TYPE]: {
        schema: {
          type: "object" as const,
          properties: {
            schemas: SCHEMA_URNS,
            status: { type: "string" as const, description: "The HTTP status, as a string." },
            detail: { type: "string" as const },
          },
        },
      },
    },
  };
}

const UNAUTHORIZED = scimErrorResponse(
  "The Authorization header is missing, is not a bearer token, or names a token this deployment does not know.",
);

const PLAN_NOT_ENTITLED = scimErrorResponse(
  "The token is valid but the organization's plan no longer includes SCIM provisioning. Entitlement is checked on every call, so a directory connection stops the moment the Enterprise plan lapses.",
);

const INVALID_BODY = scimErrorResponse(
  "The request body is not JSON, or does not match the SCIM schema for this operation.",
);

/** A 204 carries no body, so it publishes no media type either. */
const NO_CONTENT = { description: "Deprovisioned. No body.", content: {} };

// ── Discovery ────────────────────────────────────────────────────────────────

export const GET_SERVICE_PROVIDER_CONFIG: RestTransportDocs = {
  summary: "Get the SCIM service provider configuration",
  description:
    "What this SCIM implementation supports (RFC 7643 section 5), which is how an identity provider decides what it may call: PATCH and filtering are supported, bulk operations, sorting, ETags and password change are not. Unauthenticated, because a provider reads it while being configured, before a token exists.",
  tags: TAGS,
  responses: {
    200: discoveryResource({
      description: "The supported capabilities.",
      schema: {
        type: "object" as const,
        properties: {
          schemas: SCHEMA_URNS,
          documentationUri: { type: "string" as const },
          patch: SUPPORTED_FLAG,
          bulk: {
            type: "object" as const,
            properties: {
              supported: { type: "boolean" as const },
              maxOperations: { type: "integer" as const },
              maxPayloadSize: { type: "integer" as const },
            },
          },
          filter: {
            type: "object" as const,
            properties: {
              supported: { type: "boolean" as const },
              maxResults: { type: "integer" as const },
            },
          },
          changePassword: SUPPORTED_FLAG,
          sort: SUPPORTED_FLAG,
          etag: SUPPORTED_FLAG,
          authenticationSchemes: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                type: { type: "string" as const },
                name: { type: "string" as const },
                description: { type: "string" as const },
              },
            },
          },
        },
      },
    }),
  },
};

export const LIST_RESOURCE_TYPES: RestTransportDocs = {
  summary: "List the SCIM resource types",
  description:
    "The resources this service provisions, User and Group, each naming the endpoint and the schema URN that serves it (RFC 7643 section 6). Unauthenticated, like the rest of SCIM discovery.",
  tags: TAGS,
  responses: {
    200: discoveryResource({
      description: "The User and Group resource types.",
      schema: listOf(RESOURCE_TYPE),
    }),
  },
};

export const LIST_SCHEMAS: RestTransportDocs = {
  summary: "List the SCIM resource schemas",
  description:
    "The attribute definitions for the User and Group resources (RFC 7643 section 7), which an identity provider reads to build its attribute mapping. A LangWatch group is an access group: its membership drives role bindings, and it is not a team. Unauthenticated, like the rest of SCIM discovery.",
  tags: TAGS,
  responses: {
    200: discoveryResource({
      description: "The User and Group schema definitions.",
      schema: listOf(RESOURCE_SCHEMA),
    }),
  },
};

// ── Users ────────────────────────────────────────────────────────────────────

export const LIST_USERS: RestTransportDocs = {
  summary: "List provisioned users",
  description:
    'The members of the organization the token belongs to, as SCIM users. One filter expression is understood, `userName eq "someone@example.com"`, matched against the member\'s email without regard to case.',
  tags: TAGS,
  responses: {
    200: scimResource({
      description: "A page of provisioned users.",
      schema: listOf(SCIM_USER),
    }),
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
  },
};

export const CREATE_USER: RestTransportDocs = {
  summary: "Provision a user",
  description:
    "Adds a member to the organization, creating the LangWatch account when the email is new. Someone who already has an account is added and reactivated rather than refused, which is what lets a directory sync be re-run without special-casing the people it already knows. New members join with the MEMBER role at organization scope. `costCenter` on the enterprise user extension assigns their department, creating that department on first use.",
  tags: TAGS,
  responses: {
    201: scimResource({ description: "The provisioned user.", schema: SCIM_USER }),
    400: INVALID_BODY,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    409: scimErrorResponse("A member with this userName already exists in the organization."),
  },
};

export const GET_USER: RestTransportDocs = {
  summary: "Get a provisioned user",
  description:
    "Reads one member of the organization the token belongs to. An id that is not a member answers 404, whether or not it names a LangWatch account elsewhere.",
  tags: TAGS,
  responses: {
    200: scimResource({ description: "The user.", schema: SCIM_USER }),
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such member in this organization."),
  },
};

export const REPLACE_USER: RestTransportDocs = {
  summary: "Replace a provisioned user",
  description:
    "Replaces the member's attributes with the body. It is a whole-resource write, so an attribute the identity provider leaves out is reset rather than kept: omitting `active` reactivates the member. Send PATCH instead to change one attribute.",
  tags: TAGS,
  responses: {
    200: scimResource({ description: "The updated user.", schema: SCIM_USER }),
    400: INVALID_BODY,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such member in this organization."),
  },
};

export const PATCH_USER: RestTransportDocs = {
  summary: "Update a provisioned user",
  description:
    "Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `replace` of `active` (deactivating or reactivating the account), of `userName`, and of `name.givenName` / `name.familyName`, written either as an operation path or as keys inside a value object; and `add`, `replace` or `remove` of the enterprise `costCenter`, which reassigns the member's department. `replace`, `add` and `remove` are the only operation names understood, read without regard to case, so the capitalized `Replace` that Entra ID writes is accepted; any other name, or a missing or non-string one, is rejected with a 400. An understood operation aimed at anything not listed above is accepted and changes nothing.",
  tags: TAGS,
  responses: {
    200: scimResource({ description: "The updated user.", schema: SCIM_USER }),
    400: INVALID_BODY,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such member in this organization."),
  },
};

export const DELETE_USER: RestTransportDocs = {
  summary: "Deprovision a user",
  description:
    "Removes the member from the organization, drops the role bindings they held there, and deactivates their account. The LangWatch user record itself is kept, so past traces, evaluations and audit entries stay attributable.",
  tags: TAGS,
  responses: {
    204: NO_CONTENT,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such member in this organization."),
  },
};

// ── Groups ───────────────────────────────────────────────────────────────────

export const LIST_GROUPS: RestTransportDocs = {
  summary: "List provisioned groups",
  description:
    'The organization\'s SCIM-provisioned access groups. Groups created in LangWatch itself are not listed: the directory sees what it provisioned, and nothing else. One filter expression is understood, `displayName eq "Engineering"`, matched without regard to case.',
  tags: TAGS,
  responses: {
    200: scimResource({
      description: "A page of provisioned groups.",
      schema: listOf(SCIM_GROUP),
    }),
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
  },
};

export const CREATE_GROUP: RestTransportDocs = {
  summary: "Provision a group",
  description:
    "Creates an access group. Members are given as LangWatch user ids, the same ids the Users endpoints return; an id that is not a member of the organization is skipped rather than failing the call, so a group can be provisioned before everyone in it is. Granting the group access is a separate step: a group carries no permissions until a role binding is created for it.",
  tags: TAGS,
  responses: {
    201: scimResource({ description: "The provisioned group.", schema: SCIM_GROUP }),
    400: INVALID_BODY,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    409: scimErrorResponse(
      "A provisioned group with this displayName already exists in the organization.",
    ),
  },
};

export const GET_GROUP: RestTransportDocs = {
  summary: "Get a provisioned group",
  description:
    "Reads one provisioned group and its members. A group that exists but was created in LangWatch rather than provisioned is not readable here.",
  tags: TAGS,
  responses: {
    200: scimResource({ description: "The group.", schema: SCIM_GROUP }),
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such group in this organization."),
  },
};

export const REPLACE_GROUP: RestTransportDocs = {
  summary: "Replace a provisioned group",
  description:
    "Replaces the group's display name and its membership with the body. Membership is a whole-resource write: a member absent from `members` is removed from the group, and omitting `members` empties it. Role bindings granted to the group are untouched.",
  tags: TAGS,
  responses: {
    200: scimResource({ description: "The updated group.", schema: SCIM_GROUP }),
    400: INVALID_BODY,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such group in this organization."),
  },
};

export const PATCH_GROUP: RestTransportDocs = {
  summary: "Update a provisioned group",
  description:
    "Applies RFC 7644 section 3.5.2 patch operations. What is implemented: `add` of members, `remove` of members (named by a value filter on the path, as Entra ID writes it, or in the operation value), `replace` of `displayName`, and `replace` of the whole member list. `replace`, `add` and `remove` are the only operation names understood, read without regard to case, so the capitalized `Add` / `Remove` that Entra ID writes are accepted; any other name, or a missing or non-string one, is rejected with a 400. An `add` or a `remove` aimed at anything other than members is accepted and changes nothing. A `replace` that is not a `displayName` rename is treated as a replacement of the whole member list, so one that carries no members empties the group.",
  tags: TAGS,
  responses: {
    200: scimResource({ description: "The updated group.", schema: SCIM_GROUP }),
    400: INVALID_BODY,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such group in this organization."),
  },
};

export const DELETE_GROUP: RestTransportDocs = {
  summary: "Deprovision a group",
  description:
    "Deletes the group along with its memberships and every role binding granted through it, so the access it carried is revoked with it. The members themselves keep their organization membership and any access they hold directly.",
  tags: TAGS,
  responses: {
    204: NO_CONTENT,
    401: UNAUTHORIZED,
    403: PLAN_NOT_ENTITLED,
    404: scimErrorResponse("No such group in this organization."),
  },
};
