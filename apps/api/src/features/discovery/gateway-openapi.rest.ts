/**
 * `GET /api/gateway/v1/openapi.json` — the canonical location of the API
 * description, the one an integrator's generator is already pointed at.
 * @see packages/api/specs/api-discovery.feature
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";

import { WHY_DISCOVERY_IS_PUBLIC } from "./discovery-locations.ts";
import { ApiDocumentApi } from "./openapi-serve.ts";

/**
 * Literal because the family owns no prefix: `/api/gateway/v1` is shared with
 * the gateway's product routes, and a wildcard would run ahead of them. The
 * path names a generation already, so there is no `/api/v1` twin to publish.
 */
export const gatewayOpenApiRest = defineRestRouter(ApiDocumentApi)
  .withNamespace("gateway-openapi")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get("/api/gateway/v1/openapi.json", "readGatewayApiDocument")
  .withAccess(publicRoute({ reason: WHY_DISCOVERY_IS_PUBLIC }))
  // The bytes are precomputed and answered with an entity tag, so no schema
  // describes them and nothing re-serialises the document per request.
  .withRawResponse({ produces: "application/json" })
  .handle(({ app, request }) =>
    app.readDocument({ ifNoneMatch: request.headers.get("if-none-match") }),
  )
  .build();
