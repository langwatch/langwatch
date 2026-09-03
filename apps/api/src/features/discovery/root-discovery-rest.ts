/**
 * The discovery locations that sit outside `/api`, where convention puts them
 * and where an agent looks first: `/.well-known/openapi` and `/llms.txt`.
 *
 * Its own file rather than part of `./api-discovery-rest` because the OpenAPI
 * route-coverage gate applies each `/api` basePath a file declares to
 * every registration in that file. Sharing a file made the gate report
 * `/api/llms.txt` — a path that does not exist. One basePath per file keeps its
 * output truthful.
 *
 * MOUNTING: a host that routes only `/api/*` and the OTLP aliases into Hono
 * dispatches these two because it also consults `isRootDiscoveryPath`; in dev
 * they arrive because the dev server proxies them. Miss either and the
 * single-page-app fallback answers with the HTML shell and a 200, which the
 * caller reads as success — the same failure the OTLP path aliases exist to
 * prevent, and a worse one here, because a discovery request that "succeeds"
 * with HTML tells an agent the API is something it is not.
 *
 * See packages/api/specs/api-discovery.feature.
 */

import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import {
  API_OPENAPI_PATH,
  LLMS_TXT_PATH,
  WELL_KNOWN_OPENAPI_PATH,
  WHY_DISCOVERY_IS_PUBLIC,
} from "./discovery-locations";
import { respondWithApiDocument } from "./openapi-serve";

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
## Docs

- [REST API guide](https://docs.langwatch.ai/integration/rest-api): how to get
  an API key and make a first call.
- [Introduction](https://docs.langwatch.ai/introduction): what LangWatch does.
`;

export function createRootDiscoveryRestApp(options: {
  security: AppRestSecurity;
}): MountableRestApp {
  const secured = options.security.createServiceApp({ basePath: "/" });
  /**
   * Both spellings of each path. `isRootDiscoveryPath` accepts a trailing slash,
   * so the server dispatches `/llms.txt/` here; Hono routes strictly, and without
   * the second registration that dispatch would land on a 404 instead of the SPA
   * — trading one wrong answer for another. Registering the pair keeps the
   * routing rule and the route table saying the same thing.
   */
  const bothSpellings = (path: string) => [path, `${path}/`];

  for (const path of bothSpellings(WELL_KNOWN_OPENAPI_PATH)) {
    secured.access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC)).get(path, respondWithApiDocument);
  }

  for (const path of bothSpellings(LLMS_TXT_PATH)) {
    secured.access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC)).get(path, (c) =>
      c.text(LLMS_TXT, 200, {
        "Content-Type": "text/plain; charset=utf-8",
      }),
    );
  }

  return secured.hono;
}
