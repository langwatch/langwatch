/**
 * The discovery locations, served by the process itself. Deliberately NOT a
 * declared REST family: the document describes every module at once, so none
 * can own it, and the frozen artifact may not be imported out of `apps/api`.
 */
import { publicEndpoint } from "@langwatch/api";
import { registerRoutePolicy } from "@langwatch/api/rest";
import { Hono } from "hono";

import {
  API_OPENAPI_PATH,
  LLMS_TXT_PATH,
  WELL_KNOWN_OPENAPI_PATH,
  WHY_DISCOVERY_IS_PUBLIC,
} from "./discovery-locations.ts";
import { apiDocumentBytes, apiDocumentETag } from "./openapi-document.ts";

/**
 * The `/api/v1` twin: an address `/api/openapi.json` has answered at since it
 * was first published, kept so a generator pointed at either keeps working.
 */
const API_V1_OPENAPI_PATH = "/api/v1/openapi.json";

/**
 * The description's original address: reads like it belongs to the AI
 * Gateway, though the document covers the whole API — but integrators'
 * generators are already pointed at it, so it keeps answering.
 */
const GATEWAY_OPENAPI_PATH = "/api/gateway/v1/openapi.json";

/**
 * Public and immutable for the life of a deploy, but not across deploys — a
 * short max-age with revalidation, not `immutable`. A polling agent gets a
 * 304 costing ~200 bytes instead of 688 KB, picked up within the minute.
 */
const CACHE_CONTROL = "public, max-age=60, must-revalidate";

/**
 * Links are relative: a proxied self-hosted instance has no origin this
 * layer can state correctly. `Authorization` leads (new integrations should
 * send it); `X-Auth-Token` is still accepted but legacy.
 */
const LLMS_TXT = `# LangWatch

> LLM ops platform for observability, evaluation and optimization of AI agents
> and pipelines. The REST API is described by an OpenAPI 3 document.

## Authentication

Send your API key as a bearer token:

    Authorization: Bearer sk-lw-...
    X-Project-Id: <project id>

Organization-level operations take an organization key as the bearer token and
need no project header. The \`X-Auth-Token\` header is also accepted and is
legacy; new integrations should use \`Authorization\`.

## API

- [OpenAPI document](${WELL_KNOWN_OPENAPI_PATH}): the complete machine-readable
  description of the REST API. Also served at \`${API_OPENAPI_PATH}\`.

## Docs

- [REST API guide](https://docs.langwatch.ai/integration/rest-api): how to get
  an API key and make a first call.
- [Introduction](https://docs.langwatch.ai/introduction): what LangWatch does.
`;

/**
 * True when the caller already holds these bytes. `If-None-Match` is a
 * comma-separated list that may carry the `W/` weak prefix, so a bare
 * equality check would miss a hit and send 688 KB nobody needed.
 */
function alreadyHasIt(ifNoneMatch: string | null): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;

  return ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .includes(apiDocumentETag);
}

/**
 * Writes the precomputed JSON bytes without copying them. The stream body is
 * load-bearing: `new Response(bytes)` COPIES the shared buffer (134.4 MB of
 * `arrayBuffers` measured over 200 responses); enqueuing it allocates nothing.
 */
function documentResponse(): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(apiDocumentBytes);
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      ETag: apiDocumentETag,
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(apiDocumentBytes.byteLength),
    },
  });
}

/** Answers a request for the document, 200 with bytes or 304 without. */
function respondWithApiDocument(ifNoneMatch: string | null): Response {
  if (alreadyHasIt(ifNoneMatch)) {
    // 304 carries no body and no Content-Length by definition.
    return new Response(null, {
      status: 304,
      headers: { ETag: apiDocumentETag, "Cache-Control": CACHE_CONTROL },
    });
  }

  return documentResponse();
}

/** The plain-text index, written as the same bytes on every request. */
function llmsTxt(): Response {
  return new Response(LLMS_TXT, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The discovery app, for the process to mount at its own root. Both spellings
 * of each root-level path are routed: `isRootDiscoveryPath` accepts a
 * trailing slash but Hono routes strictly, so `/llms.txt/` would 404 without it.
 */
export function createDiscoveryApp(): Hono {
  const app = new Hono();
  const policy = publicEndpoint(WHY_DISCOVERY_IS_PUBLIC);

  const documentPaths = [
    { path: API_OPENAPI_PATH, canonicalPath: API_V1_OPENAPI_PATH },
    { path: API_V1_OPENAPI_PATH },
    { path: GATEWAY_OPENAPI_PATH },
    { path: WELL_KNOWN_OPENAPI_PATH },
    { path: `${WELL_KNOWN_OPENAPI_PATH}/` },
  ] as const;

  for (const { path, ...registration } of documentPaths) {
    registerRoutePolicy({
      method: "get",
      path,
      ...registration,
      policy,
      family: "discovery",
      credentialClass: "none",
      credential: "public",
    });
    app.get(path, (context) =>
      respondWithApiDocument(context.req.raw.headers.get("if-none-match")),
    );
  }

  for (const path of [LLMS_TXT_PATH, `${LLMS_TXT_PATH}/`]) {
    registerRoutePolicy({
      method: "get",
      path,
      policy,
      family: "discovery",
      credentialClass: "none",
      credential: "public",
    });
    app.get(path, () => llmsTxt());
  }

  return app;
}
