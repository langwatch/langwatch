/**
 * The discovery locations that live under `/api`.
 *
 * The API description already existed and was already public —
 * `./gateway-openapi-rest` has served it at `/api/gateway/v1/openapi.json`
 * since the gateway contract pinned that URL. But the document is titled
 * "LangWatch API" and covers all 42 families, while the URL reads like it
 * belongs to the AI Gateway, and nothing pointed at it. An agent had no way to
 * arrive there except by being handed the string.
 *
 * So this adds no second description of the API. `GET /api/openapi.json` serves
 * the same `apiDocument`, so the two cannot disagree.
 *
 * The root-level locations — `/.well-known/openapi` and `/llms.txt` — are in
 * `./root-discovery-rest`, in a file of their own rather than here. That is not
 * taste: the OpenAPI route-coverage gate reads a file's declared `/api`
 * basePaths and applies each to every registration in the file, so a root-level
 * route sharing this file is reported at a path that does not exist
 * (`/api/llms.txt`). One basePath per file keeps the gate's output truthful.
 *
 * See packages/api/specs/api-discovery.feature.
 */

import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { WHY_DISCOVERY_IS_PUBLIC } from "./discovery-locations";
import { respondWithApiDocument } from "./openapi-serve";

export function createApiDiscoveryRestApp(options: {
  security: AppRestSecurity;
}): MountableRestApp {
  const secured = options.security.createServiceApp({ basePath: "/api" });

  secured
    .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
    .get("/openapi.json", respondWithApiDocument);

  return secured.hono;
}
