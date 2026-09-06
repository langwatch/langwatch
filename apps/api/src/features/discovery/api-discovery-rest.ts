/**
 * The discovery locations under `/api`: `GET /api/openapi.json` serves the
 * same `apiDocument` already published at `/api/gateway/v1/openapi.json`, now
 * reachable from a path that doesn't read as AI-Gateway-only. Root-level
 * locations live in `./root-discovery-rest` instead, one basePath per file,
 * so the route-coverage gate never reports a nonexistent path.
 */

import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

import { WHY_DISCOVERY_IS_PUBLIC } from "./discovery-locations.ts";
import { respondWithApiDocument } from "./openapi-serve.ts";

export function createApiDiscoveryRestApp(options: {
  security: AppRestSecurity;
}): MountableRestApp {
  const secured = options.security.createServiceApp({ basePath: "/api" });

  secured
    .access(publicEndpoint(WHY_DISCOVERY_IS_PUBLIC))
    .get("/openapi.json", respondWithApiDocument);

  return secured.mountable;
}
