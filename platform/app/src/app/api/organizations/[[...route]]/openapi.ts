/**
 * The published operations for the self-hosted organization provisioning
 * family (the api-keys `openapi.ts` pattern: typed DescribeRouteOptions
 * constants, request bodies left to the zod validators so the generator
 * cannot drift from them).
 *
 * `security` names the instance credential rather than an organization key:
 * this family exists before any organization does. On SaaS, and on
 * deployments that have not configured `LANGWATCH_INSTANCE_ADMIN_API_KEY`,
 * every path answers 404; the reference documents the self-hosted
 * capability.
 */
import type { DescribeRouteOptions, GenerateSpecOptions } from "hono-openapi";

type ResponseSpec = NonNullable<DescribeRouteOptions["responses"]>[string];

const INSTANCE_KEY_SECURITY: DescribeRouteOptions["security"] = [
  { instance_admin_key: [] },
];

/**
 * The instance credential itself, reaching the merged document through
 * `generateSpecs(organizationsApp, ORGANIZATIONS_SPEC_OPTIONS)`. A security
 * requirement naming a scheme the document never declares does not degrade
 * gracefully: the reference renders an operation nobody can authenticate, and
 * a client generator resolving `#/components/securitySchemes/...` finds
 * nothing there.
 */
export const ORGANIZATIONS_SPEC_OPTIONS: Partial<GenerateSpecOptions> = {
  documentation: {
    components: {
      securitySchemes: {
        instance_admin_key: {
          type: "http",
          scheme: "bearer",
          description:
            "Instance administrator key, set as LANGWATCH_INSTANCE_ADMIN_API_KEY on a self-hosted deployment. It exists to create the first organization, before any organization key does; every other management API takes an organization key instead.",
        },
      },
    },
  },
};

type SchemaSpec = NonNullable<
  NonNullable<Extract<ResponseSpec, { content?: unknown }>["content"]>[string]["schema"]
>;

const ORGANIZATION_SUMMARY_SCHEMA: SchemaSpec = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
  },
};

/**
 * The refusal body this family answers with. It is the SecuredApp legacy
 * envelope rather than the `{ error: { code, ... } }` one the organization-key
 * management families publish, because this family predates no organization at
 * all and authenticates against the instance; `error` carries the stable code
 * a provisioning tool branches on.
 */
const ERROR_SCHEMA: SchemaSpec = {
  type: "object",
  properties: {
    error: {
      type: "string",
      description: "Stable machine-readable code, e.g. organization_slug_taken",
    },
    message: { type: "string" },
  },
};

const errorResponse = (description: string): ResponseSpec => ({
  description,
  content: { "application/json": { schema: ERROR_SCHEMA } },
});

const NOT_AVAILABLE_404: ResponseSpec = errorResponse(
  "Organization provisioning is not available: the instance administrator key is not configured, this is a cloud deployment, or (on GET /{id}) the organization does not exist",
);

export const CREATE_ORGANIZATION: DescribeRouteOptions = {
  operationId: "provisionOrganization",
  summary: "Create an organization",
  description:
    "Self-hosted only. Creates an organization with a default team and returns an organization-scoped admin API key, so provisioning can continue through the management APIs without a browser step: the instance key creates the organization, the returned key does everything else. The slug is the natural key; a taken slug answers 409 organization_slug_taken.",
  tags: ["Organizations (Self-Hosted)"],
  security: INSTANCE_KEY_SECURITY,
  responses: {
    "201": {
      description:
        "Organization created. adminApiKey.token is the bootstrap credential and is only shown once.",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              organization: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  slug: { type: "string" },
                },
              },
              team: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  slug: { type: "string" },
                },
              },
              adminApiKey: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  token: {
                    type: "string",
                    description:
                      "Plaintext organization admin API key (sk-lw-...). Store securely: shown only once.",
                  },
                },
              },
            },
          },
        },
      },
    },
    "401": errorResponse("Invalid instance administrator credential"),
    "404": NOT_AVAILABLE_404,
    "409": errorResponse(
      "An organization with this slug already exists (organization_slug_taken)",
    ),
    "422": errorResponse(
      "The request body did not match the schema, for example a slug that is not lowercase letters, numbers and single hyphens",
    ),
  },
};

export const LIST_ORGANIZATIONS: DescribeRouteOptions = {
  operationId: "listOrganizations",
  summary: "List organizations",
  description:
    "Self-hosted only. Lists every organization on this instance, newest first.",
  tags: ["Organizations (Self-Hosted)"],
  security: INSTANCE_KEY_SECURITY,
  responses: {
    "200": {
      description: "Organizations on this instance",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              organizations: {
                type: "array",
                items: ORGANIZATION_SUMMARY_SCHEMA,
              },
            },
          },
        },
      },
    },
    "401": errorResponse("Invalid instance administrator credential"),
    "404": NOT_AVAILABLE_404,
  },
};

export const GET_ORGANIZATION: DescribeRouteOptions = {
  operationId: "getOrganizationById",
  summary: "Get an organization",
  description: "Self-hosted only. Reads one organization's summary by id.",
  tags: ["Organizations (Self-Hosted)"],
  security: INSTANCE_KEY_SECURITY,
  parameters: [
    {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
      description: "Organization ID",
    },
  ],
  responses: {
    "200": {
      description: "The organization",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              organization: ORGANIZATION_SUMMARY_SCHEMA,
            },
          },
        },
      },
    },
    "401": errorResponse("Invalid instance administrator credential"),
    "404": NOT_AVAILABLE_404,
  },
};
