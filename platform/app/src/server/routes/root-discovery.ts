/**
 * The discovery locations that sit outside `/api`, where convention puts them
 * and where an agent looks first: `/.well-known/openapi` and `/llms.txt`.
 *
 * Its own file rather than part of `./api-discovery` because
 * `check-openapi-route-coverage` applies each `/api` basePath a file declares to
 * every registration in that file. Sharing a file made the gate report
 * `/api/llms.txt` — a path that does not exist. One basePath per file keeps its
 * output truthful.
 *
 * MOUNTING: `start.ts` routes only `/api/*` and the OTLP aliases into Hono, so
 * these two arrive because it also consults `isRootDiscoveryPath`; in dev they
 * arrive because `vite.config.ts` proxies them. Miss either and the
 * single-page-app fallback answers with the HTML shell and a 200, which the
 * caller reads as success — the same failure the OTLP path aliases exist to
 * prevent, and a worse one here, because a discovery request that "succeeds"
 * with HTML tells an agent the API is something it is not.
 *
 * See specs/api-reference/api-discovery.feature.
 */

import { createServiceApp, publicEndpoint } from "~/server/api/security";
import {
  API_OPENAPI_PATH,
  LLMS_TXT_PATH,
  RPC_DISCOVER_PATH,
  WELL_KNOWN_OPENAPI_PATH,
  WHY_DISCOVERY_IS_PUBLIC,
} from "~/server/openapi/discovery-locations";
import { apiDocument } from "~/server/openapi/document";

/**
 * Links are relative on purpose. A self-hosted instance behind a proxy has no
 * origin this layer can state correctly — the request URL is the internal one —
 * and every consumer resolves a relative link against the URL it just fetched,
 * which is the right answer for both app.langwatch.ai and a private deployment.
 *
 * `Authorization` leads because it is what a new integration should send.
 * `X-Auth-Token` is still accepted and `auth-middleware.ts` calls it legacy in
 * its own comments, so putting it first would teach the header we intend to
 * retire.
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
- [RPC catalogue](${RPC_DISCOVER_PATH}): POST for the RPC-named operations and
  their argument schemas, without reading the whole document.

## Docs

- [REST API guide](https://docs.langwatch.ai/integration/rest-api): how to get
  an API key and make a first call.
- [Introduction](https://docs.langwatch.ai/introduction): what LangWatch does.
`;

const secured = createServiceApp({ basePath: "/" });

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .get(WELL_KNOWN_OPENAPI_PATH, (c) => c.json(apiDocument));

secured
  .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
  .get(LLMS_TXT_PATH, (c) =>
    c.text(LLMS_TXT, 200, {
      "Content-Type": "text/plain; charset=utf-8",
    }),
  );

export const app = secured.hono;
