/**
 * The project credential both ingestion doors (SDK collector, OTLP
 * receiver) resolve for themselves. One resolution, two refusal
 * vocabularies; both ask for `traces:create` as the key's ceiling.
 */
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type {
  OtlpIngestCredential,
  OtlpIngestCredentialInput,
  OtlpIngestRefusalStatus,
} from "@langwatch/trace-contract";

import type { CollectorCredential } from "../transport/collector.rest.ts";
import {
  readTraceIngestCredentials,
  readTraceLegacyRequestCredentials,
  type TraceLegacyRequestCredentials,
  TRACE_LEGACY_INVALID_CREDENTIAL_MESSAGE,
  TRACE_LEGACY_MISSING_CREDENTIAL_MESSAGE,
} from "./trace-legacy-credential.service.ts";

/** Exactly the API-key directory operations an ingestion door reaches. */
export type TraceIngestApiKeys = Pick<ApiKeyApi, "findResolvedToken" | "markUsed">;

/** The one permission an ingestion key is measured against. */
const INGEST_PERMISSION = "traces:create" as const;

/** A resolved ingestion credential, or the status and body its refusal earned. */
type TraceIngestResolution =
  | Readonly<{ ok: true; resolved: ResolvedApiKeyCredential; markUsed: () => void }>
  | Readonly<{ ok: false; status: OtlpIngestRefusalStatus; body: object }>;

/** The two peers this door reads, and nothing else. */
export type TraceIngestCredentialOptions = Readonly<{
  /** Narrowed to what this door calls: it resolves a token and stamps its clock. */
  apiKeys: TraceIngestApiKeys;
  authz: Pick<AuthzApi, "hasApiKeyPermission">;
  logger?: Pick<Logger, "error"> | undefined;
}>;

export class TraceIngestCredentialService {
  static create(options: TraceIngestCredentialOptions): TraceIngestCredentialService {
    return new TraceIngestCredentialService(
      options.apiKeys,
      options.authz,
      options.logger ?? createLogger("langwatch:trace:ingest-credential"),
    );
  }

  #apiKeys: TraceIngestApiKeys;
  #authz: Pick<AuthzApi, "hasApiKeyPermission">;
  #logger: Pick<Logger, "error">;

  private constructor(
    apiKeys: TraceIngestApiKeys,
    authz: Pick<AuthzApi, "hasApiKeyPermission">,
    logger: Pick<Logger, "error">,
  ) {
    this.#apiKeys = apiKeys;
    this.#authz = authz;
    this.#logger = logger;
  }

  /**
   * The collector's own vocabulary. A 401 is "we do not know this credential",
   * which the door answers with its own long-standing sentence; anything else
   * is a key we know and refused, whose full handled body travels.
   */
  async resolveForCollector(input: { request: Request }): Promise<CollectorCredential> {
    const resolution = await this.#authenticate(input.request);
    if (!resolution.ok) {
      return resolution.status === 401
        ? { ok: false, kind: "credential" }
        : { ok: false, kind: "ceiling", status: resolution.status, body: resolution.body };
    }

    return {
      ok: true,
      project: projectOf(resolution.resolved),
      markUsed: resolution.markUsed,
    };
  }

  /** The receiver's vocabulary, plus the identity it stamps provenance from. */
  async resolveForOtlp(input: OtlpIngestCredentialInput): Promise<OtlpIngestCredential> {
    const resolution = await this.#authenticateCredentials(readTraceIngestCredentials(input));
    if (!resolution.ok) {
      return { ok: false, status: resolution.status, body: resolution.body };
    }

    const { resolved } = resolution;
    const project = projectOf(resolved);

    return {
      ok: true,
      project,
      identity:
        resolved.type === "apiKey"
          ? {
              apiKeyId: resolved.apiKeyId,
              organizationId: resolved.organizationId,
              ingestSourceType: resolved.ingestSourceType,
              ingestionTemplateId: resolved.ingestionTemplateId,
            }
          : {
              apiKeyId: null,
              organizationId: project.organizationId,
              ingestSourceType: null,
              ingestionTemplateId: null,
            },
    };
  }

  /** The receiver calls this only after it has parsed a valid signal body. */
  markOtlpCredentialUsed(input: { apiKeyId: string }): void {
    this.#apiKeys.markUsed({ id: input.apiKeyId });
  }

  /**
   * Present, then resolves, then within the key's ceiling - in that order, so a
   * caller with no credential at all is never told a permission is missing.
   */
  async #authenticate(request: Request): Promise<TraceIngestResolution> {
    return this.#authenticateCredentials(readTraceLegacyRequestCredentials(request));
  }

  async #authenticateCredentials(
    credentials: TraceLegacyRequestCredentials | null,
  ): Promise<TraceIngestResolution> {
    if (!credentials) {
      return { ok: false, status: 401, body: { message: TRACE_LEGACY_MISSING_CREDENTIAL_MESSAGE } };
    }

    const resolved = await this.#apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      return { ok: false, status: 401, body: { message: TRACE_LEGACY_INVALID_CREDENTIAL_MESSAGE } };
    }

    // A legacy project key has no per-permission ceiling: project keys predate
    // RBAC and carry full project access by design.
    if (resolved.type === "apiKey") {
      const allowed = await this.#authz.hasApiKeyPermission({
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId ?? null,
        organizationId: resolved.organizationId,
        scope: { type: "project", id: resolved.project.id, teamId: resolved.project.teamId },
        permission: INGEST_PERMISSION,
      });
      if (!allowed) {
        const refusal = this.#ceilingRefusal(resolved);
        return {
          ok: false,
          status: refusal.httpStatus === 401 ? 401 : 403,
          body: handledErrorResponseBody(refusal),
        };
      }
    }

    return {
      ok: true,
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.#apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  #ceilingRefusal(resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>): HandledError {
    this.#logger.error(
      {
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId ?? null,
        projectId: resolved.project.id,
        permission: INGEST_PERMISSION,
      },
      "API key ceiling denial",
    );
    return new ApiKeyPermissionDeniedError(INGEST_PERMISSION);
  }
}

/** The three ids both doors record a batch against. */
function projectOf(
  resolved: ResolvedApiKeyCredential,
): Readonly<{ id: string; teamId: string; organizationId: string }> {
  return {
    id: resolved.project.id,
    teamId: resolved.project.teamId,
    organizationId: resolved.project.organizationId,
  };
}

/**
 * The wire body for a handled error answered by a door rather than by an error
 * boundary: the code as the discriminant, the sentence, the meta bag spread
 * flat, and the remediation channel alongside.
 */
function handledErrorResponseBody(error: HandledError): object {
  const { code, message, meta, tips, docsUrl, fault, retryable } = error;
  return {
    error: code,
    message,
    ...meta,
    ...(tips?.length ? { tips } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(fault ? { fault } : {}),
    retryable: retryable === true,
  };
}
