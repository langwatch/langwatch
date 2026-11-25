import {
  ApiKeyPermissionDeniedError,
  ApiKeyPermissionNotDelegableError,
  LegacyProjectKeyIngestionOnlyError,
} from "@langwatch/api-key-contract";
import {
  PermissionDeniedError,
  type AuthzPermission,
  type RestResolvedProjectCredential,
} from "@langwatch/authorization";
import type { HandledError } from "@langwatch/handled-error";
import { createWarnThrottle, type Logger } from "@langwatch/observability";

import { isUndelegatedForLangy } from "../rules/langy-key-delegation.rules.ts";
import type {
  ApiKeyDoorCredential,
  ApiKeyPermissionReach,
  ApiProjectCredential,
} from "./api-rest-credentials.service.ts";

/** How long a refused key stays quiet after its ceiling-refusal line. */
const CEILING_REFUSAL_LOG_WINDOW_MS = 5 * 60_000;

/** The refusal a credential that lacks a permission gets, by credential kind (record §8). */
export class ApiCredentialRefusalService {
  static create(peers: {
    logger: Pick<Logger, "warn">;
    now: () => number;
  }): ApiCredentialRefusalService {
    return new ApiCredentialRefusalService(peers.logger, peers.now);
  }

  /** One ceiling-refusal line per key per window: a refused client retries the same fact. */
  private readonly ceilingRefusalLog = createWarnThrottle(CEILING_REFUSAL_LOG_WINDOW_MS);

  private constructor(
    private readonly logger: Pick<Logger, "warn">,
    private readonly now: () => number,
  ) {}

  /** A project door refusal: a legacy key is ingestion-only, an API key hit its ceiling. */
  project(input: { credential: ApiProjectCredential; permission: AuthzPermission }): HandledError {
    const { credential, permission } = input;
    if (!credential.actsAsPerson && credential.resolved.type === "legacyProjectKey") {
      return new LegacyProjectKeyIngestionOnlyError({ permission });
    }
    if (!credential.actsAsPerson && credential.resolved.type === "apiKey") {
      return this.ceiling({ resolved: credential.resolved, permission });
    }

    return new ApiKeyPermissionDeniedError(permission);
  }

  /** A key door refusal, at the scope the key was asked at. */
  key(input: {
    credential: ApiKeyDoorCredential;
    permission: AuthzPermission;
    reach?: ApiKeyPermissionReach;
  }): HandledError {
    const { principal, organizationId } = input.credential;
    if (principal.kind === "project") {
      return new LegacyProjectKeyIngestionOnlyError({ permission: input.permission });
    }
    const projectId =
      principal.kind === "apiKey" ? principal.resolvedProject?.id : principal.projectId;

    return new PermissionDeniedError({
      permission: input.permission,
      scope:
        input.reach !== "organization" && projectId
          ? { type: "project", id: projectId }
          : { type: "organization", id: organizationId },
      denialReason: "no-grant",
    });
  }

  /**
   * The key's own configuration refuses the permission: a customer fault, so a
   * warning, and only when the key's log window let it through.
   */
  private ceiling(input: {
    resolved: Extract<RestResolvedProjectCredential, { type: "apiKey" }>;
    permission: AuthzPermission;
  }): HandledError {
    const { resolved, permission } = input;
    const suppressedRefusals = this.ceilingRefusalLog.claim({
      key: resolved.apiKeyId,
      now: this.now(),
    });
    if (suppressedRefusals !== undefined) {
      this.logger.warn(
        {
          apiKeyId: resolved.apiKeyId,
          userId: resolved.userId ?? null,
          projectId: resolved.project.id,
          permission,
          suppressedRefusals,
        },
        "API key ceiling denial",
      );
    }
    return isUndelegatedForLangy({ key: resolved, permission })
      ? new ApiKeyPermissionNotDelegableError(permission, { subject: "Langy" })
      : new ApiKeyPermissionDeniedError(permission);
  }
}
