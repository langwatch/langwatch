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

export const LIST_PROJECTS: DescribeRouteOptions = {
  operationId: "listProjects",
  summary: "List projects",
  description:
    "List all non-archived projects for the organization (paginated). Requires an admin API key with project:view permission.",
  security: [
    {
      admin_api_key: [],
    },
  ],
  parameters: [
    {
      in: "query",
      name: "page",
      schema: {
        type: "integer",
        minimum: 1,
        default: 1,
      },
    },
    {
      in: "query",
      name: "limit",
      schema: {
        type: "integer",
        minimum: 1,
        maximum: 1000,
        default: 50,
      },
    },
  ],
  responses: {
    "200": {
      description: "Paginated list of projects",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/Project",
                },
              },
              pagination: {
                $ref: "#/components/schemas/Pagination",
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
      description: "Insufficient permissions for this operation",
    },
  },
};

export const CREATE_PROJECT: DescribeRouteOptions = {
  operationId: "createProject",
  summary: "Create a project",
  description:
    "Create a new project in the organization. Returns the project with its API key (sk-lw-...) for sending traces. Provide either teamId (existing team) or newTeamName (creates a new team). Requires project:create permission.",
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
              maxLength: 255,
              description: "Project name",
            },
            teamId: {
              type: "string",
              description: "ID of an existing team to assign the project to",
            },
            newTeamName: {
              type: "string",
              maxLength: 255,
              description: "Name for a new team to create and assign the project to",
            },
            language: {
              type: "string",
              description: "Programming language (e.g. python, typescript)",
            },
            framework: {
              type: "string",
              description: "Framework (e.g. langchain, vercel-ai, openai)",
            },
          },
          required: ["name", "language", "framework"],
        },
      },
    },
  },
  responses: {
    "201": {
      description: "Project created. Returns a scoped service API key for this project.",
      content: {
        "application/json": {
          schema: {
            allOf: [
              {
                $ref: "#/components/schemas/Project",
              },
              {
                type: "object",
                properties: {
                  serviceApiKey: {
                    type: "string",
                    description:
                      "Scoped service API key with ADMIN on this project (sk-lw-..._...). Store securely \u2014 shown only once.",
                  },
                  serviceApiKeyId: {
                    type: "string",
                    description:
                      "ID of the auto-created service key, for management via DELETE /api/api-keys/{id}.",
                  },
                },
              },
            ],
          },
        },
      },
    },
    "400": {
      description: "Team does not belong to this organization",
    },
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description: "Insufficient permissions (requires project:create)",
    },
    "409": {
      description: "A project with this name already exists in the team",
    },
    "422": {
      description: "Validation error (missing required fields)",
    },
  },
};

export const GET_PROJECT: DescribeRouteOptions = {
  operationId: "getProject",
  summary: "Get a project",
  description: "Get a project by ID, including its API key. Requires project:view permission.",
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
      description: "Project ID (project_...)",
    },
  ],
  responses: {
    "200": {
      description: "Project details.",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Project",
          },
        },
      },
    },
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description: "Insufficient permissions for this operation",
    },
    "404": {
      description: "Project not found",
    },
  },
};

export const UPDATE_PROJECT: DescribeRouteOptions = {
  operationId: "updateProject",
  summary: "Update a project",
  description:
    "Update project fields. Only provided fields are changed. Requires project:update permission.",
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
      description: "Project ID",
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
              maxLength: 255,
            },
            language: {
              type: "string",
            },
            framework: {
              type: "string",
            },
            piiRedactionLevel: {
              type: "string",
              enum: ["STRICT", "ESSENTIAL", "DISABLED"],
            },
          },
        },
      },
    },
  },
  responses: {
    "200": {
      description: "Updated project",
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/Project",
          },
        },
      },
    },
    "401": {
      description: "Invalid or missing API key token",
    },
    "403": {
      description: "Insufficient permissions (requires project:update)",
    },
    "404": {
      description: "Project not found",
    },
  },
};

export const ARCHIVE_PROJECT: DescribeRouteOptions = {
  operationId: "archiveProject",
  summary: "Archive a project",
  description:
    "Soft-delete (archive) a project. Archived projects are excluded from list responses. Requires project:delete permission.",
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
      description: "Project ID",
    },
  ],
  responses: {
    "200": {
      description: "Project archived",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              name: {
                type: "string",
              },
              archivedAt: {
                type: "string",
                format: "date-time",
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
      description: "Insufficient permissions (requires project:delete)",
    },
    "404": {
      description: "Project not found",
    },
  },
};

/**
 * The project's own ingestion key. Reading it is gated on `project:update`
 * rather than `project:view`, to match the write access the key itself grants.
 */
export const GET_PROJECT_API_KEY: DescribeRouteOptions = {
  operationId: "getProjectApiKey",
  summary: "Get the project API key",
  description:
    "Read the project's API key, the credential SDKs and the ingestion endpoints authenticate with. Requires an admin API key holding project:update on this project.",
  security: [
    {
      admin_api_key: [],
    },
  ],
  parameters: [
    {
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
      description: "Project id",
    },
  ],
  responses: {
    "200": {
      description: "The project's API key",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              apiKey: {
                type: "string",
                description: "Send as X-Auth-Token, Bearer, or Basic",
              },
            },
            required: ["apiKey"],
          },
        },
      },
    },
    "401": { description: "Invalid or missing API key token" },
    "403": { description: "Insufficient permissions for this operation" },
    "404": { description: "No project with that id in this organization" },
  },
};

export const REGENERATE_PROJECT_API_KEY: DescribeRouteOptions = {
  operationId: "regenerateProjectApiKey",
  summary: "Regenerate the project API key",
  description:
    "Issue a new API key for the project and invalidate the previous one immediately. Anything still sending the old key starts failing authentication as soon as this returns, so roll it out before calling this. Requires an admin API key holding project:manage.",
  security: [
    {
      admin_api_key: [],
    },
  ],
  parameters: [
    {
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
      description: "Project id",
    },
  ],
  responses: {
    "200": {
      description: "The new API key. The previous one no longer authenticates.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              apiKey: {
                type: "string",
                description: "Send as X-Auth-Token, Bearer, or Basic",
              },
            },
            required: ["apiKey"],
          },
        },
      },
    },
    "401": { description: "Invalid or missing API key token" },
    "403": { description: "Insufficient permissions for this operation" },
    "404": { description: "No project with that id in this organization" },
  },
};
