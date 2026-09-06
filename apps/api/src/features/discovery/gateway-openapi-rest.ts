/**
 * Serves the OpenAPI description at GET /api/gateway/v1/openapi.json. Mounts
 * FIRST in `/api/gateway/v1` so a later parameterised sibling cannot shadow it.
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

  return secured.mountable;
}
