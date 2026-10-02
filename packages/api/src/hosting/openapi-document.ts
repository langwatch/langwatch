import { createHash } from "node:crypto";

import type { Hono, MiddlewareHandler } from "hono";
/**
 * The OpenAPI document: generated from the mounted REST families' own describeRoute()/validator()
 * metadata. Nothing commits it; the api serves it and the SDK and docs builds generate it from the
 * same declarations (dev/docs/ARCHITECTURE.md).
 */
import { generateSpecs } from "hono-openapi";

import {
  dropHeadTwins,
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

/** Public for the life of a deploy, but not across deploys: revalidated, never `immutable`. */
const CACHE_CONTROL = "public, max-age=60, must-revalidate";

type PublishedDocument = Readonly<{ bytes: Uint8Array<ArrayBuffer>; etag: string }>;

/**
 * The OpenAPI document over RestHost.app, generated once when the route is mounted. Every
 * location sharing this handler serves one document under one entity tag
 * (packages/api/specs/api-discovery.feature).
 */
export function openapiDocumentRoute(restApp: Hono): MiddlewareHandler {
  let published: Promise<PublishedDocument> | undefined;
  const generate = () =>
    (published ??= publish(restApp).catch((failure: unknown) => {
      published = undefined;
      throw failure;
    }));

  // Started at mount so the first caller does not pay for it; a failure is retried by the next
  // request rather than left as an unhandled rejection.
  generate().catch(() => void 0);

  return async (context) => {
    const { bytes, etag } = await generate();
    const headers = { ETag: etag, "Cache-Control": CACHE_CONTROL };

    if (alreadyHeld({ ifNoneMatch: context.req.header("if-none-match"), etag })) {
      return new Response(null, { status: 304, headers });
    }

    return jsonBytesResponse({ bytes, headers });
  };
}

/**
 * The whole document a REST application describes: what the route serves, and what the SDK and
 * docs builds write to disk before they read it.
 */
export async function buildOpenApiDocument(restApp: Hono): Promise<Record<string, unknown>> {
  const generated = await generateSpecs(restApp, { documentation: documentation() });
  // The corrections rewrite in place, and hono-openapi hands every call the SAME
  // resolved schema objects, so they run over a copy.
  const document: unknown = JSON.parse(JSON.stringify(generated));

  hoistStraySchemaDefs(document);
  publishEnumRecordKeys(document);
  dropHeadTwins(document);

  return normalizeExclusiveBounds(document) as Record<string, unknown>;
}

async function publish(restApp: Hono): Promise<PublishedDocument> {
  const bytes = Buffer.from(JSON.stringify(await buildOpenApiDocument(restApp)), "utf8");
  const digest = createHash("sha256").update(bytes).digest("base64url").slice(0, 27);

  return { bytes, etag: `"${digest}"` };
}

/** `If-None-Match` is a comma-separated list whose tags may carry the weak `W/` prefix. */
function alreadyHeld({ ifNoneMatch, etag }: { ifNoneMatch: string | undefined; etag: string }) {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;

  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .includes(etag);
}

/** A stream over the shared bytes: handing `Response` the array itself copies it per request. */
function jsonBytesResponse({
  bytes,
  headers,
}: {
  bytes: Uint8Array<ArrayBuffer>;
  headers: Record<string, string>;
}): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
