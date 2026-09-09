/**
 * This family's seven published operations, verbatim from the hand-maintained
 * document minus what the framework derives: operation id, security,
 * parameters and request body. `$ref`s resolve against merged components.
 */

import type { RestTransportDocs, RouteResponse } from "@langwatch/api/rest";

const INVALID_TOKEN: RouteResponse = {
  description: "Invalid or missing API key token",
  content: {},
};

const INSUFFICIENT_PERMISSIONS: RouteResponse = {
  description: "Insufficient permissions for this operation",
  content: {},
};

const PROJECT_NOT_FOUND: RouteResponse = {
  description: "Project not found",
  content: {},
};

/** One project, as every route that answers with one publishes it. */
const projectResponse = (description: string): RouteResponse => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } },
});

/** The project's own ingestion credential, as both key routes publish it. */
const apiKeyResponse = (description: string): RouteResponse => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          apiKey: { type: "string", description: "Send as X-Auth-Token, Bearer, or Basic" },
        },
        required: ["apiKey"],
      },
    },
  },
});

export const LIST_PROJECTS: RestTransportDocs = {
  summary: "List projects",
  description:
    "List all non-archived projects for the organization (paginated). Requires an admin API key with project:view permission.",
  responses: {
    200: {
      description: "Paginated list of projects",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: { type: "array", items: { $ref: "#/components/schemas/Project" } },
              pagination: { $ref: "#/components/schemas/Pagination" },
            },
          },
        },
      },
    },
    401: INVALID_TOKEN,
    403: INSUFFICIENT_PERMISSIONS,
  },
};

export const CREATE_PROJECT: RestTransportDocs = {
  summary: "Create a project",
  description:
    "Create a new project in the organization. Returns the project with its API key (sk-lw-...) for sending traces. Provide either teamId (existing team) or newTeamName (creates a new team). Requires project:create permission.",
  responses: {
    201: {
      description: "Project created. Returns a scoped service API key for this project.",
      content: {
        "application/json": {
          schema: {
            allOf: [
              { $ref: "#/components/schemas/Project" },
              {
                type: "object",
                properties: {
                  serviceApiKey: {
                    type: "string",
                    description:
                      "Scoped service API key with ADMIN on this project (sk-lw-..._...). Store securely — shown only once.",
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
    400: { description: "Team does not belong to this organization", content: {} },
    401: INVALID_TOKEN,
    403: { description: "Insufficient permissions (requires project:create)", content: {} },
    409: { description: "A project with this name already exists in the team", content: {} },
    422: { description: "Validation error (missing required fields)", content: {} },
  },
};

export const GET_PROJECT: RestTransportDocs = {
  summary: "Get a project",
  description: "Get a project by ID, including its API key. Requires project:view permission.",
  responses: {
    200: projectResponse("Project details."),
    401: INVALID_TOKEN,
    403: INSUFFICIENT_PERMISSIONS,
    404: PROJECT_NOT_FOUND,
  },
};

export const UPDATE_PROJECT: RestTransportDocs = {
  summary: "Update a project",
  description:
    "Update project fields. Only provided fields are changed. Requires project:update permission.",
  responses: {
    200: projectResponse("Updated project"),
    401: INVALID_TOKEN,
    403: { description: "Insufficient permissions (requires project:update)", content: {} },
    404: PROJECT_NOT_FOUND,
  },
};

export const ARCHIVE_PROJECT: RestTransportDocs = {
  summary: "Archive a project",
  description:
    "Soft-delete (archive) a project. Archived projects are excluded from list responses. Requires project:delete permission.",
  responses: {
    200: {
      description: "Project archived",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              archivedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    401: INVALID_TOKEN,
    403: { description: "Insufficient permissions (requires project:delete)", content: {} },
    404: PROJECT_NOT_FOUND,
  },
};

/**
 * The project's own ingestion key. Reading it is gated on `project:update`
 * rather than `project:view`, to match the write access the key itself grants.
 */
export const GET_PROJECT_API_KEY: RestTransportDocs = {
  summary: "Get the project API key",
  description:
    "Read the project's API key, the credential SDKs and the ingestion endpoints authenticate with. Requires an admin API key holding project:update on this project.",
  responses: {
    200: apiKeyResponse("The project's API key"),
    401: INVALID_TOKEN,
    403: INSUFFICIENT_PERMISSIONS,
    404: { description: "No project with that id in this organization", content: {} },
  },
};

export const REGENERATE_PROJECT_API_KEY: RestTransportDocs = {
  summary: "Regenerate the project API key",
  description:
    "Issue a new API key for the project and invalidate the previous one immediately. Anything still sending the old key starts failing authentication as soon as this returns, so roll it out before calling this. Requires an admin API key holding project:manage.",
  responses: {
    200: apiKeyResponse("The new API key. The previous one no longer authenticates."),
    401: INVALID_TOKEN,
    403: INSUFFICIENT_PERMISSIONS,
    404: { description: "No project with that id in this organization", content: {} },
  },
};
