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
 * The project's own ingestion key; two operations no longer answer here but
 * stay documented (not removed) so a caller with the old integration learns
 * what happened rather than seeing a 404 that implies the project is gone.
 */
export const GET_PROJECT_API_KEY: RestTransportDocs = {
  summary: "Get the project API key",
  description:
    "Deprecated. Project base keys can be revealed only by a signed-in project administrator in the browser or an approved device flow. Organization API keys are always refused with 403.",
  responses: {
    401: INVALID_TOKEN,
    403: {
      description:
        "A signed-in project administrator is required; API-key principals cannot reveal base keys",
      content: {},
    },
  },
};

export const REGENERATE_PROJECT_API_KEY: RestTransportDocs = {
  summary: "Regenerate the project API key",
  description:
    "Deprecated. Project base keys can be rotated only by a signed-in project administrator in the browser. Organization API keys are always refused with 403.",
  responses: {
    401: INVALID_TOKEN,
    403: {
      description:
        "A signed-in project administrator is required; API-key principals cannot rotate base keys",
      content: {},
    },
  },
};
