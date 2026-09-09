/**
 * `GET /api/openapi.json` — the same description as the gateway location, from
 * a path that does not read as AI-Gateway-only. The root-level locations live
 * in `./root-discovery-rest.ts`. @see packages/api/specs/api-discovery.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";

import { WHY_DISCOVERY_IS_PUBLIC } from "./discovery-locations.ts";
import { ApiDocumentApi } from "./openapi-serve.ts";

/**
 * Literal because twenty-one families share `/api` and none of them owns it.
 * The `/api/v1` twin stays: `/api/v1/openapi.json` is an address this location
 * has answered at since it was first published.
 */
export const apiDiscoveryRest = defineRestRouter(ApiDocumentApi)
  .withNamespace("api-discovery")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .get("/api/openapi.json", "readApiDocument")
  .withAccess(publicRoute({ reason: WHY_DISCOVERY_IS_PUBLIC }))
  // Precomputed bytes with an entity tag: no schema describes them, and the
  // 304 an agent that polls gets back has no body to describe at all.
  .withRawResponse({ produces: "application/json" })
  .handle(({ app, request }) =>
    app.readDocument({ ifNoneMatch: request.headers.get("if-none-match") }),
  )
  .build();
