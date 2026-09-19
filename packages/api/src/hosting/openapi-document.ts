import type { Hono } from "hono";
/**
 * The live twin of the document apps/api/src/features/discovery used to
 * freeze: instead of a byte buffer checked in once, this walks whatever
 * REST families are actually mounted right now and generates the document
 * from their own describeRoute()/validator() metadata (packages/api/src/rest
 * attaches both at declaration time). A route added, renamed or removed
 * changes this document the moment the process restarts — nothing to keep
 * in sync by hand, nothing that can go stale the way the frozen file did.
 */
import { openAPIRouteHandler } from "hono-openapi";

const SECURITY_SCHEMES = {
  project_api_key: {
    type: "apiKey",
    in: "header",
    name: "X-Auth-Token",
    description:
      "Project API key for sending traces and accessing project-scoped resources. Format: sk-lw-... (no underscore). Obtain one by creating a project via the Admin API or the LangWatch UI.",
  },
  admin_api_key: {
    type: "http",
    scheme: "bearer",
    description:
      "Admin API key for organization-level operations (managing projects, API keys). Create one in Settings > API Keys or via POST /api/api-keys. Format: sk-lw-{id}_{secret}.",
  },
  scim_bearer: {
    type: "http",
    scheme: "bearer",
    description:
      "SCIM token for one organization's directory connection, created with POST /api/scim-tokens or in Settings > SCIM. It authenticates provisioning calls only, and stops working if the organization's Enterprise plan lapses.",
  },
  instance_admin_key: {
    type: "http",
    scheme: "bearer",
    description:
      "Instance administrator key, set as LANGWATCH_INSTANCE_ADMIN_API_KEY on a self-hosted deployment. It exists to create the first organization, before any organization key does; every other management API takes an organization key instead.",
  },
  internal_secret: {
    type: "http",
    scheme: "bearer",
    description:
      "The deployment's own shared secret, presented by another LangWatch service rather than by a customer. The families behind it are ingress-blocked; they are described so a self-hosted operator can see what the deployment talks to itself about.",
  },
} as const;

/** Mounted at GET /api/openapi.json — restApp is RestHost.app, every family's own router. */
export function openapiDocumentRoute(restApp: Hono) {
  return openAPIRouteHandler(restApp, {
    documentation: {
      openapi: "3.1.0",
      info: {
        title: "LangWatch API",
        description: "LangWatch openapi spec",
        version: "1.0.0",
      },
      servers: [{ url: "https://app.langwatch.ai" }],
      security: [{ project_api_key: [] }],
      components: { securitySchemes: SECURITY_SCHEMES },
    },
  });
}
