/**
 * `apiKey.*`, composed as its own feature: a project's credentials and the
 * application every other door reads one through. The trail a mint, a rotation
 * and a revocation leave is the runtime's own automatic mutation row now, so
 * this composition reaches nothing outside the feature at all.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";

import { createApiKeyTrpcRouter } from "./api-key-trpc.mount.ts";

import type { ComposedApiKeyFeature } from "./api-key.composition.types.ts";

/** Composes `apiKey.*` over this process's own credential service. */
export function composeApiKeyFeature(options: {
  /** The SAME credential service every REST door authenticates a caller through. */
  app: ApiKeyApi;
}): ComposedApiKeyFeature {
  return {
    app: options.app,
    router: (mount) => createApiKeyTrpcRouter({ runtime: mount.runtime }),
  };
}
