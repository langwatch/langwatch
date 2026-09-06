/**
 * The discovery locations outside `/api`: `/.well-known/openapi` and
 * `/llms.txt`. A host must dispatch both via `isRootDiscoveryPath`, or the
 * SPA fallback answers 200 with HTML. See packages/api/specs/api-discovery.feature.
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

export function createRootDiscoveryRestApp(options: {
  security: AppRestSecurity;
}): MountableRestApp {
  const secured = options.security.createServiceApp({ basePath: "/" });
  /**
   * Both spellings of each path: `isRootDiscoveryPath` accepts a trailing
   * slash, but Hono routes strictly, so the second registration keeps them saying
   * the same thing rather than 404ing where the routing rule would dispatch.
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

  return secured.mountable;
}
