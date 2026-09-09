/**
 * Binds `/.well-known/openapi` and `/llms.txt` to this process. Like its two
 * siblings under `/api` it reaches nothing this process composed: the bytes are
 * precomputed at import time and the locations resolve no credential.
 */
import { createRestRuntime, type MountableRestApp } from "@langwatch/api/rest";

import { discoveryErrors, noDiscoveryCredential } from "./discovery-rest.boundary.ts";
import { apiDocument } from "./openapi-serve.ts";
import { rootDiscoveryRest } from "./root-discovery.rest.ts";

/** The two discovery locations outside `/api`, at both spellings of each. */
export function mountRootDiscoveryRest(): MountableRestApp {
  const runtime = createRestRuntime({ identity: { authenticate: noDiscoveryCredential } });

  return runtime.mount(rootDiscoveryRest.router(), {
    app: () => apiDocument,
    credential: "public",
    onError: discoveryErrors,
  });
}
