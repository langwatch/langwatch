/**
 * `apiKey.*`, composed as its own feature. A project's credentials, the application every
 * other door reads one through, and the one thing the surface reaches that the feature
 * does not own: the trail a mint, a rotation and a revocation are recorded on.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";

import type { ApiAuditPort } from "../../api-request.policy.ts";

import { createApiKeyTrpcRouter, type ApiKeyAuditSink } from "./api-key-trpc.mount.ts";

import type { ComposedApiKeyFeature } from "./api-key.composition.types.ts";

/** Composes `apiKey.*` over this process's own credential service and trail. */
export function composeApiKeyFeature(options: {
  /**
   * The trail a mint, a rotation and a revocation are recorded on. Absent on a
   * process that composed no sink: the three writes then record nothing, which
   * is the same degradation every other door on this process already has.
   */
  audit: ApiAuditPort | undefined;
  /** The SAME credential service every REST door authenticates a caller through. */
  app: ApiKeyApi;
}): ComposedApiKeyFeature {
  return {
    app: options.app,
    router: (mount) =>
      createApiKeyTrpcRouter({
        runtime: mount.runtime,
        recordAudit: recordApiKeyAudit(options.audit),
      }),
  };
}

/**
 * Fire and forget, exactly as the API-key router has always recorded it: a
 * credential response never waits on the audit write. The minted token is
 * never among the arguments the package passes here.
 */
function recordApiKeyAudit(audit: ApiAuditPort | undefined): ApiKeyAuditSink["recordAudit"] {
  return (entry) => {
    void audit?.record({
      actorId: entry.userId,
      path: entry.action,
      input: { organizationId: entry.organizationId, args: entry.args },
      error: null,
    });
  };
}
