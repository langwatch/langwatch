/**
 * The published operations for this family, moved out of the hand-maintained
 * document and into the app that serves them.
 *
 * These were authored by hand in `openapiLangWatch.json` while the routes
 * themselves carried a one-line `describeRoute`, so the generator could not
 * produce them and the document had to keep them by not being regenerated over
 * them. Two routes that had no hand-written entry -- reading and regenerating
 * a project's API key -- were therefore unpublishable without this move.
 *
 * They are reproduced verbatim, `operationId` included: the ids are load
 * bearing, since `openapi-python-client` turns them into the Python SDK's
 * function names, and `security` is restated because this family takes an
 * organization admin key rather than the project key the document requires at
 * its root.
 *
 * `$ref`s point at components that stay in the JSON; `paths` is replaced on
 * merge but `components` is merged, so they keep resolving.
 *
 * Request bodies are NOT declared here: the generator builds them from each
 * route's zod schema and overwrites whatever this file says, so a body written
 * out by hand can only ever be a second copy that drifts.
 */

import type { DescribeRouteOptions } from "hono-openapi";
import type { OpenAPIV3_1 } from "openapi-types";

type ResponseSpec = NonNullable<DescribeRouteOptions["responses"]>[string];

/**
 * Accepts a schema written the 3.0 way in a 3.1 document.
 *
 * `nullable: true` was removed in OpenAPI 3.1 in favour of a type array
 * (`type: ["string", "null"]`), and this document declares `openapi: 3.1.0`.
 * hono-openapi v0.4's types were loose enough not to notice; v1 types responses
 * as `OpenAPIV3_1.SchemaObject` and rejects the key outright.
 *
 * The keys stay as they are. They are already published — 80 of them across the
 * document, most from the hand-maintained JSON rather than this file — and
 * rewriting them changes what generators emit for those fields. That is a
 * correctness fix worth making on its own, against the whole document and with
 * the client-side change understood; smuggling it into a library upgrade would
 * mean shipping it unannounced.
 */
const legacySchema = (schema: object): OpenAPIV3_1.SchemaObject =>
  schema as OpenAPIV3_1.SchemaObject;

/** The organization admin key every operation in this family takes. */
const ADMIN_KEY_SECURITY: DescribeRouteOptions["security"] = [
  { admin_api_key: [] },
];

/** The path parameter the by-id operations share. */
const ID_PARAMETER: DescribeRouteOptions["parameters"] = [
  {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "API key ID",
  },
];

const BINDING_ROLES = ["ADMIN", "MEMBER", "VIEWER", "CUSTOM"];
const BINDING_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"];

/**
 * One key, as `GET /{id}` and `PATCH /{id}` both report it.
 *
 * `roleBindings` is the shape the listing publishes; `bindings` is the same
 * set in the shape a write accepts, so a key can be read back and compared to
 * what was sent without translating between two vocabularies.
 */
const apiKeyDetailResponse = (description: string): ResponseSpec => ({
  description,
  content: {
    "application/json": {
      schema: legacySchema({
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          keyType: { type: "string", enum: ["personal", "service"] },
          assignedToUserId: {
            type: "string",
            nullable: true,
            description: "The member who owns the key; null for a service key.",
          },
          createdByUserId: { type: "string", nullable: true },
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
          expiresAt: { type: "string", format: "date-time", nullable: true },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          revokedAt: { type: "string", format: "date-time", nullable: true },
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
      }),
    },
  },
});

export const LIST_API_KEYS: DescribeRouteOptions = {
  operationId: "listApiKeys",
  summary: "List API keys",
  description:
    "List all API keys owned by the authenticated user in this organization. Requires organization:view permission.",
  security: ADMIN_KEY_SECURITY,
  responses: {
    "200": {
      description: "List of API keys",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/ApiKeyInfo",
                },
              },
            },
          },
        },
      },
    },
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description: "Insufficient permissions (requires organization:view)",
    },
  },
};

export const CREATE_API_KEY: DescribeRouteOptions = {
  operationId: "createApiKey",
  summary: "Create an API key",
  description:
    'Create a new API key. For service keys, pass keyType:"service". Optionally scope to specific projects via projectIds (ADMIN on each). Omit projectIds for full org access. Pass assignedToUserId to mint the key for another member, and permissionMode:"restricted" with a permissions list to grant exactly those permissions. Minting a service key or a key for another member requires organization admin rights. The plaintext token is returned once \u2014 store it securely.',
  security: ADMIN_KEY_SECURITY,
  responses: {
    "201": {
      description:
        "API key created. The token field contains the plaintext key \u2014 it is only shown once.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              token: {
                type: "string",
                description:
                  "Plaintext API key token (sk-lw-...). Store securely \u2014 shown only once.",
              },
              apiKey: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                  },
                  name: {
                    type: "string",
                  },
                  createdAt: {
                    type: "string",
                    format: "date-time",
                  },
                },
              },
            },
          },
        },
      },
    },
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description:
        "Requested binding exceeds the creator's own permissions, or the scope does not belong to this organization (api_key_scope_violation); a service key or a key for another member was requested without organization admin rights (insufficient_permissions)",
    },
    "422": {
      description:
        "Validation error, for example a missing name or empty bindings (validation_error), or a name LangWatch reserves for its own keys (api_key_reserved_name)",
    },
  },
};

export const GET_API_KEY: DescribeRouteOptions = {
  operationId: "getApiKey",
  summary: "Get an API key",
  description:
    "Read one API key by id, including its role bindings, permission mode and explicit permissions. Returns your own keys; organization admins may read any key in the organization. The secret is never returned. An id that does not exist, belongs to another organization, or belongs to another member all answer 404 api_key_not_found, so the response cannot be used to probe for keys.",
  security: ADMIN_KEY_SECURITY,
  parameters: ID_PARAMETER,
  responses: {
    "200": apiKeyDetailResponse("The API key"),
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description: "Insufficient permissions (requires organization:view)",
    },
    "404": {
      description: "API key not found (api_key_not_found)",
    },
  },
};

export const UPDATE_API_KEY: DescribeRouteOptions = {
  operationId: "updateApiKey",
  summary: "Update an API key",
  description:
    "Update an API key's name, description, permission mode, permissions or bindings. Every field is optional; bindings are replaced outright, and the response is exactly what a subsequent GET returns. You may update your own keys; organization admins may update any key in the organization. Bindings can never exceed the access of the member the key belongs to. The token itself never changes.",
  security: ADMIN_KEY_SECURITY,
  parameters: ID_PARAMETER,
  responses: {
    "200": apiKeyDetailResponse("The updated API key"),
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description:
        "Insufficient permissions (requires organization:manage), the requested binding exceeds the key owner's own permissions, or the scope does not belong to this organization (api_key_scope_violation)",
    },
    "404": {
      description:
        "API key not found, or not yours to edit (api_key_not_found)",
    },
    "409": {
      description: "API key is already revoked (api_key_already_revoked)",
    },
    "422": {
      description:
        "Validation error, for example restricted mode without a permissions list (validation_error)",
    },
  },
};

export const REVOKE_API_KEY: DescribeRouteOptions = {
  operationId: "revokeApiKey",
  summary: "Revoke an API key",
  description:
    "Revoke (soft-delete) an API key. Revoked keys can no longer authenticate. Requires organization:manage permission.",
  security: ADMIN_KEY_SECURITY,
  parameters: ID_PARAMETER,
  responses: {
    "200": {
      description: "API key revoked successfully",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              success: {
                type: "boolean",
              },
            },
          },
        },
      },
    },
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description:
        "Not authorized to revoke this API key, which belongs to another member (api_key_not_owned)",
    },
    "404": {
      description: "API key not found (api_key_not_found)",
    },
    "409": {
      description: "API key is already revoked (api_key_already_revoked)",
    },
  },
};
