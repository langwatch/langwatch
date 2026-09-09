/**
 * This family's five published operations, verbatim from `openapiLangWatch.json`
 * minus what the framework derives: operation id, security, path parameters and
 * request body. `$ref`s resolve against components the document merges.
 */

import type { RestTransportDocs, RouteResponse } from "@langwatch/api/rest";

/** Every operation in this family is filed under one tag. */
const TAGS = ["API Keys"] as const;

const BINDING_ROLES = ["ADMIN", "MEMBER", "VIEWER", "CUSTOM"];
const BINDING_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"];

/**
 * One key, as `GET /{id}` and `PATCH /{id}` both report it. `roleBindings` is
 * the shape the listing publishes; `bindings` is the same set in the shape a
 * write accepts, so a key reads back comparable to what was sent.
 */
const apiKeyDetailResponse = (description: string): RouteResponse => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: ["string", "null"] },
          keyType: { type: "string", enum: ["personal", "service"] },
          assignedToUserId: {
            type: ["string", "null"],
            description: "The member who owns the key; null for a service key.",
          },
          createdByUserId: { type: ["string", "null"] },
          permissionMode: {
            type: "string",
            enum: ["all", "readonly", "restricted"],
          },
          permissions: {
            type: "array",
            items: { type: "string" },
            description:
              "The resource:action permissions a restricted key grants. Empty for the other modes.",
          },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: ["string", "null"], format: "date-time" },
          lastUsedAt: { type: ["string", "null"], format: "date-time" },
          revokedAt: { type: ["string", "null"], format: "date-time" },
          roleBindings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                role: { type: "string", enum: BINDING_ROLES },
                scopeType: { type: "string", enum: BINDING_SCOPE_TYPES },
                scopeId: { type: "string" },
              },
            },
          },
          bindings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: BINDING_ROLES },
                scopeType: { type: "string", enum: BINDING_SCOPE_TYPES },
                scopeId: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});

const INVALID_TOKEN: RouteResponse = {
  description: "Invalid or missing API key token",
  content: {},
};

export const LIST_API_KEYS: RestTransportDocs = {
  tags: TAGS,
  summary: "List API keys",
  description:
    "List all API keys owned by the authenticated user in this organization. Requires organization:view permission.",
  responses: {
    200: {
      description: "List of API keys",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: { $ref: "#/components/schemas/ApiKeyInfo" },
              },
            },
          },
        },
      },
    },
    401: INVALID_TOKEN,
    403: {
      description: "Insufficient permissions (requires organization:view)",
      content: {},
    },
  },
};

export const CREATE_API_KEY: RestTransportDocs = {
  tags: TAGS,
  summary: "Create an API key",
  description:
    'Create a new API key. For service keys, pass keyType:"service". Optionally scope to specific projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId to mint the key for another member, and permissionMode:"restricted" with a permissions list to grant exactly those permissions. Minting a service key or a key for another member requires organization admin rights. The plaintext token is returned once — store it securely.',
  responses: {
    201: {
      description:
        "API key created. The token field contains the plaintext key — it is only shown once.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              token: {
                type: "string",
                description:
                  "Plaintext API key token (sk-lw-...). Store securely — shown only once.",
              },
              apiKey: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    401: INVALID_TOKEN,
    403: {
      description:
        "Requested binding exceeds the creator's own permissions, or the scope does not belong to this organization (api_key_scope_violation); a service key or a key for another member was requested without organization admin rights (api_key_admin_required)",
      content: {},
    },
    422: {
      description:
        "Validation error, for example a missing name or empty bindings (validation_error), or a name LangWatch reserves for its own keys (api_key_reserved_name)",
      content: {},
    },
  },
};

export const GET_API_KEY: RestTransportDocs = {
  tags: TAGS,
  summary: "Get an API key",
  description:
    "Read one API key by id, including its role bindings, permission mode and explicit permissions. Returns your own keys; organization admins may read any key in the organization. The secret is never returned. An id that does not exist, belongs to another organization, or belongs to another member all answer 404 api_key_not_found, so the response cannot be used to probe for keys.",
  responses: {
    200: apiKeyDetailResponse("The API key"),
    401: INVALID_TOKEN,
    403: {
      description: "Insufficient permissions (requires organization:view)",
      content: {},
    },
    404: { description: "API key not found (api_key_not_found)", content: {} },
  },
};

export const UPDATE_API_KEY: RestTransportDocs = {
  tags: TAGS,
  summary: "Update an API key",
  description:
    "Update an API key's name, description, permission mode, permissions or bindings. Every field is optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns. You may update your own keys; organization admins may update any key in the organization. Bindings can never exceed the access of the member the key belongs to. The token itself never changes.",
  responses: {
    200: apiKeyDetailResponse("The updated API key"),
    401: INVALID_TOKEN,
    403: {
      description:
        "Insufficient permissions (requires organization:manage), the requested binding exceeds the key owner's own permissions, or the scope does not belong to this organization (api_key_scope_violation)",
      content: {},
    },
    404: {
      description: "API key not found, or not yours to edit (api_key_not_found)",
      content: {},
    },
    409: {
      description: "API key is already revoked (api_key_already_revoked)",
      content: {},
    },
    422: {
      description:
        "Validation error, for example restricted mode without a permissions list (validation_error)",
      content: {},
    },
  },
};

export const REVOKE_API_KEY: RestTransportDocs = {
  tags: TAGS,
  summary: "Revoke an API key",
  description:
    "Revoke (soft-delete) an API key. Revoked keys can no longer authenticate. Requires organization:manage permission.",
  responses: {
    200: {
      description: "API key revoked successfully",
      content: {
        "application/json": {
          schema: { type: "object", properties: { success: { type: "boolean" } } },
        },
      },
    },
    401: INVALID_TOKEN,
    403: {
      description:
        "Not authorized to revoke this API key, which belongs to another member (api_key_not_owned)",
      content: {},
    },
    404: { description: "API key not found (api_key_not_found)", content: {} },
    409: {
      description: "API key is already revoked (api_key_already_revoked)",
      content: {},
    },
  },
};
