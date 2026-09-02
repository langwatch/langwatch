/**
 * Serves the generated OpenAPI description of the LangWatch REST API at
 * GET /api/gateway/v1/openapi.json, the location published in
 * specs/ai-gateway/_shared/contract.md section 12.
 *
 * This is the location the gateway contract pins, and it is not the one a
 * caller who has not read that contract will try. `./api-discovery-rest` and
 * `./root-discovery-rest` serve the same document at `/api/openapi.json` and
 * `/.well-known/openapi` for those, from the same bytes — three URLs, one
 * document, by construction.
 *
 * ORDERING: this unauthenticated spec document shares the `/api/gateway/v1`
 * namespace with the credentialed gateway resource routes, so it mounts FIRST
 * and cannot be shadowed by a sibling that later grows a parameterised segment
 * at the root of that namespace.
 */
import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { respondWithApiDocument } from "./openapi-serve";

export function createGatewayOpenApiRestApp(options: {
  security: AppRestSecurity;
}): MountableRestApp {
  const secured = options.security.createServiceApp({ basePath: "/api/gateway/v1" });

  secured
    .access(
      publicEndpoint(
        "the description of a public API, listing the endpoints and the credentials they want; a caller reads it to learn how to authenticate, so requiring authentication to read it would be circular, and it carries no tenant data",
      ),
    )
    .get("/openapi.json", respondWithApiDocument);

  return secured.hono;
}
