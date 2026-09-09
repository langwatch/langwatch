/**
 * Binds `/api/openapi.json` to this process. Like its gateway twin it reaches
 * nothing this process composed: the bytes are precomputed at import time and
 * the location resolves no credential.
 */
import { createRestRuntime, type MountableRestApp } from "@langwatch/api/rest";

import { apiDiscoveryRest } from "./api-discovery.rest.ts";
import { discoveryErrors, noDiscoveryCredential } from "./discovery-rest.boundary.ts";
import { apiDocument } from "./openapi-serve.ts";

/** `/api/openapi.json` and its `/api/v1` twin. */
export function mountApiDiscoveryRest(): MountableRestApp {
  const runtime = createRestRuntime({ identity: { authenticate: noDiscoveryCredential } });

  return runtime.mount(apiDiscoveryRest.router(), {
    app: () => apiDocument,
    credential: "public",
    onError: discoveryErrors,
  });
}
