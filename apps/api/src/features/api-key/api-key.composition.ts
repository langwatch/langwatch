/**
 * `apiKey.*`, composed as its own feature. A project's credentials, the application every
 * other door reads one through, and the one thing the surface reaches that the feature
 * does not own: the trail a mint, a rotation and a revocation are recorded on.
 */
import type { ApiKeyService } from "@langwatch/api-key-contract";
import { ApiKeyApp } from "@langwatch/api-key-server";
import { HandledError } from "@langwatch/handled-error";

import type { ApiAuditPort } from "../../api-request.policy";
import type { ApiTrpcFeatureMount } from "../../api.application";
import { createApiKeyTrpcRouter, type ApiKeyAuditSink } from "./api-key-trpc.mount";

/** The one namespace this feature mounts, and the slice behind it. */
export type ComposedApiKeyFeature = Readonly<{
  /** The `ctx.app.apiKeys` slice. */
  app: ApiKeyApp;
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createApiKeyTrpcRouter>;
}>;

/** Composes `apiKey.*` over this process's own credential service and trail. */
export function composeApiKeyFeature(options: {
  /**
   * The trail a mint, a rotation and a revocation are recorded on. Absent on a
   * process that composed no sink: the three writes then record nothing, which
   * is the same degradation every other door on this process already has.
   */
  audit: ApiAuditPort | undefined;
  /** The SAME credential service every REST door authenticates a caller through. */
  peers: Readonly<{ apiKeys: ApiKeyService }>;
}): ComposedApiKeyFeature {
  return {
    app: ApiKeyApp.create({ apiKeys: options.peers.apiKeys }),
    router: (mount) =>
      createApiKeyTrpcRouter({ ...mount, recordAudit: recordApiKeyAudit(options.audit) }),
  };
}

/**
 * `apiKey.*` on a process that composed no credential service. The namespace still mounts
 * and every call refuses by name, so a person is told the deployment holds no credential
 * store rather than shown a project with no keys in it.
 */
export function refusingApiKeyFeature(): ComposedApiKeyFeature {
  const refuse = (): never => {
    throw new ApiKeyUnavailableError("credential store");
  };

  return {
    app: new Proxy({}, { get: () => refuse, has: () => true }) as ApiKeyApp,
    router: (mount) => createApiKeyTrpcRouter({ ...mount, recordAudit: () => undefined }),
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

/** A capability this deployment did not compose, refused by name. */
export class ApiKeyUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiKeyUnavailableError";
  }
}
