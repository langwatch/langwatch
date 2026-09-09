/**
 * Binds the gateway contract's description location to this process. The
 * document is precomputed at import time, so the family reaches nothing this
 * process composed and resolves no credential at all.
 */
import { createRestRuntime, type MountableRestApp } from "@langwatch/api/rest";

import { discoveryErrors, noDiscoveryCredential } from "./discovery-rest.boundary.ts";
import { gatewayOpenApiRest } from "./gateway-openapi.rest.ts";
import { apiDocument } from "./openapi-serve.ts";

/** `/api/gateway/v1/openapi.json`, mounted FIRST so no sibling can shadow it. */
export function mountGatewayOpenApiRest(): MountableRestApp {
  const runtime = createRestRuntime({ identity: { authenticate: noDiscoveryCredential } });

  return runtime.mount(gatewayOpenApiRest.router(), {
    app: () => apiDocument,
    credential: "public",
    onError: discoveryErrors,
  });
}
