import type { Hono, MiddlewareHandler } from "hono";
/**
 * The live OpenAPI document: generated from the mounted REST families' own
 * describeRoute()/validator() metadata, so it changes with the routes on restart and cannot go
 * stale like the frozen file.
 */
import { generateSpecs } from "hono-openapi";

import {
  hoistStraySchemaDefs,
  normalizeExclusiveBounds,
  publishEnumRecordKeys,
} from "../rest/openapi.ts";

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
  cli_access_token: {
    type: "http",
    scheme: "bearer",
    description:
      "The device session the LangWatch CLI holds after `langwatch login`. It acts as the person who signed in, in the organization they chose, and expires unless the CLI refreshes it.",
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

/** The document's own preamble, merged over whatever the mounted routes describe. */
function documentation() {
  return {
    openapi: "3.1.0",
    info: {
      title: "LangWatch API",
      description: "LangWatch openapi spec",
      version: "1.0.0",
    },
    servers: [{ url: "https://app.langwatch.ai" }],
    security: [{ project_api_key: [] }],
    components: { securitySchemes: SECURITY_SCHEMES, schemas: {} },
  };
}

/**
 * GET /api/openapi.json over RestHost.app, with the two corrections schema builders cannot make:
 * 3.1's numeric exclusive bounds, and hoisting recursive `$defs` whose refs dangle
 * (specs/api-reference).
 */
export function openapiDocumentRoute(restApp: Hono): MiddlewareHandler {
  return async (context) => {
    const generated = await generateSpecs(restApp, { documentation: documentation() });
    // The corrections rewrite in place, and hono-openapi hands every request the
    // SAME resolved schema objects: correcting those would leave the second request
    // a `$defs` block already hoisted away and a ref pointing at nothing.
    const document: unknown = JSON.parse(JSON.stringify(generated));

    hoistStraySchemaDefs(document);
    publishEnumRecordKeys(document);

    return context.json(normalizeExclusiveBounds(document));
  };
}
