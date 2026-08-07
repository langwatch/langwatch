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
 */

import type { DescribeRouteOptions } from "hono-openapi";

export const LIST_API_KEYS: DescribeRouteOptions = {
  operationId: "listApiKeys",
  summary: "List API keys",
  description:
    "List all API keys owned by the authenticated user in this organization. Requires organization:view permission.",
  security: [
    {
      admin_api_key: [],
    },
  ],
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
    'Create a new API key. For service keys, pass keyType:"service". Optionally scope to specific projects via projectIds (ADMIN on each). Omit projectIds for full org access. The plaintext token is returned once \u2014 store it securely.',
  security: [
    {
      admin_api_key: [],
    },
  ],
  requestBody: {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              description: "Human-readable name for this token",
            },
            description: {
              type: "string",
              maxLength: 500,
              description: "Optional description",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: "Optional expiration date (ISO 8601)",
            },
            bindings: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              description:
                "Role bindings that define what this token can access",
              items: {
                type: "object",
                properties: {
                  role: {
                    type: "string",
                    enum: ["ADMIN", "MEMBER", "VIEWER"],
                    description: "Role to grant",
                  },
                  scopeType: {
                    type: "string",
                    enum: ["ORGANIZATION", "TEAM", "PROJECT"],
                    description: "Scope level",
                  },
                  scopeId: {
                    type: "string",
                    description: "ID of the organization, team, or project",
                  },
                },
                required: ["role", "scopeType", "scopeId"],
              },
            },
            keyType: {
              type: "string",
              enum: ["personal", "service"],
              default: "personal",
              description:
                "personal = tied to a user. service = not tied to any user, for automation.",
            },
            projectIds: {
              type: "array",
              items: {
                type: "string",
              },
              maxItems: 50,
              description:
                "For service keys with restricted scope: list of project IDs to grant ADMIN access to. Omit for full org access.",
            },
          },
          required: ["name", "bindings"],
        },
      },
    },
  },
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
        "Requested binding exceeds the creator's own permissions, or scope does not belong to this organization",
    },
    "422": {
      description: "Validation error (missing name, empty bindings, etc.)",
    },
  },
};

export const REVOKE_API_KEY: DescribeRouteOptions = {
  operationId: "revokeApiKey",
  summary: "Revoke an API key",
  description:
    "Revoke (soft-delete) an API key. Revoked keys can no longer authenticate. Requires organization:manage permission.",
  security: [
    {
      admin_api_key: [],
    },
  ],
  parameters: [
    {
      name: "id",
      in: "path",
      required: true,
      schema: {
        type: "string",
      },
      description: "API key ID",
    },
  ],
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
        "Not authorized to revoke this API key (owned by another user)",
    },
    "404": {
      description: "API key not found",
    },
    "409": {
      description: "API key is already revoked",
    },
  },
};
