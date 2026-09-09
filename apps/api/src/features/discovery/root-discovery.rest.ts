/**
 * The discovery locations outside `/api`: `/.well-known/openapi` and
 * `/llms.txt`. A host must dispatch both via `isRootDiscoveryPath`, or the SPA
 * fallback answers 200 with HTML. @see packages/api/specs/api-discovery.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";

import {
  API_OPENAPI_PATH,
  LLMS_TXT_PATH,
  WELL_KNOWN_OPENAPI_PATH,
  WHY_DISCOVERY_IS_PUBLIC,
} from "./discovery-locations.ts";
import { ApiDocumentApi } from "./openapi-serve.ts";

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

const discovery = publicRoute({ reason: WHY_DISCOVERY_IS_PUBLIC });

/** The plain-text index, written as the same bytes on every request. */
function llmsTxt(): Response {
  return new Response(LLMS_TXT, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Literal AND rooted: these two addresses sit outside `/api` altogether, so
 * there is no namespace to hang them off and no `/api/v1` prefix to twin.
 *
 * Both spellings of each path are declared: `isRootDiscoveryPath` accepts a
 * trailing slash and Hono routes strictly, so without the second registration
 * the host dispatches `/llms.txt/` here and this family 404s it.
 */
export const rootDiscoveryRest = defineRestRouter(ApiDocumentApi)
  .withNamespace("root-discovery")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false, root: true })

  .get(WELL_KNOWN_OPENAPI_PATH, "readWellKnownDocument")
  .withAccess(discovery)
  // Precomputed bytes with an entity tag, exactly as `/api/openapi.json`
  // answers them: no schema describes them, and a 304 has no body at all.
  .withRawResponse({ produces: "application/json" })
  .handle(({ app, request }) =>
    app.readDocument({ ifNoneMatch: request.headers.get("if-none-match") }),
  )

  .get(`${WELL_KNOWN_OPENAPI_PATH}/`, "readWellKnownDocumentSlashed")
  .withAccess(discovery)
  .withRawResponse({ produces: "application/json" })
  .handle(({ app, request }) =>
    app.readDocument({ ifNoneMatch: request.headers.get("if-none-match") }),
  )

  .get(LLMS_TXT_PATH, "readLlmsIndex")
  .withAccess(discovery)
  .withRawResponse({ produces: "text/plain" })
  .handle(() => llmsTxt())

  .get(`${LLMS_TXT_PATH}/`, "readLlmsIndexSlashed")
  .withAccess(discovery)
  .withRawResponse({ produces: "text/plain" })
  .handle(() => llmsTxt())
  .build();
