/**
 * `apiKey.*`, composed as its own feature.
 *
 * A project's credentials, and the one thing the surface reaches that the
 * feature does not own: the trail a mint, a rotation and a revocation are
 * recorded on. That trail is the PROCESS's, so it arrives through the shared
 * infrastructure rather than through a group half that happened to hold it.
 */
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createApiKeyTrpcRouter, type ApiKeyAuditSink } from "./api-key-trpc.mount";

/** Builds `apiKey.*` on this process's root, over this process's own trail. */
export function composeApiKeyTrpcRouter(options: {
  mount: ApiTrpcFeatureMount;
  infrastructure: ApiTrpcInfrastructure;
}) {
  return createApiKeyTrpcRouter({
    ...options.mount,
    recordAudit: recordApiKeyAudit(options.infrastructure),
  });
}

/**
 * Fire and forget, exactly as the API-key router has always recorded it: a
 * credential response never waits on the audit write. The minted token is
 * never among the arguments the package passes here.
 */
function recordApiKeyAudit(infrastructure: ApiTrpcInfrastructure): ApiKeyAuditSink["recordAudit"] {
  return (entry) => {
    void infrastructure.audit?.record({
      actorId: entry.userId,
      path: entry.action,
      input: { organizationId: entry.organizationId, args: entry.args },
      error: null,
    });
  };
}
