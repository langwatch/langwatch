/**
 * Where the API describes itself: one OpenAPI document at every location a caller tries, and
 * a plain-text index for a reader with no schema in mind. Public, because a caller reads them
 * to learn how to authenticate (packages/api/specs/api-discovery.feature).
 */
import type { Hono } from "hono";

import { openapiDocumentRoute } from "./openapi-document.ts";

const WELL_KNOWN_OPENAPI_PATH = "/.well-known/openapi";
const API_OPENAPI_PATH = "/api/openapi.json";
const GATEWAY_OPENAPI_PATH = "/api/gateway/v1/openapi.json";
const LLMS_TXT_PATH = "/llms.txt";

/** Links stay relative: behind a proxy this layer cannot know the origin the caller used. */
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

/** The root-level pair answers with and without one trailing slash, as the router admits both. */
export function mountApiDiscovery({ root, restApp }: { root: Hono; restApp: Hono }): void {
  const document = openapiDocumentRoute(restApp);

  for (const path of [API_OPENAPI_PATH, GATEWAY_OPENAPI_PATH]) root.get(path, document);

  for (const path of [WELL_KNOWN_OPENAPI_PATH, `${WELL_KNOWN_OPENAPI_PATH}/`]) {
    root.get(path, document);
  }

  for (const path of [LLMS_TXT_PATH, `${LLMS_TXT_PATH}/`]) {
    root.get(path, (context) =>
      context.text(LLMS_TXT, 200, { "Content-Type": "text/plain; charset=utf-8" }),
    );
  }
}
