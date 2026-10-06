/**
 * The project credential both ingestion doors (SDK collector, OTLP
 * receiver) resolve for themselves. One resolution, refused by throwing;
 * each door renders the refusal in its own vocabulary.
 */
import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "@langwatch/api";
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OtlpIngestCredential, OtlpIngestCredentialInput } from "@langwatch/trace-contract";

import {
  extractTraceIngestCredentials,
  extractTraceLegacyRequestCredentials,
  type TraceLegacyRequestCredentials,
} from "../rules/trace-request-credentials.rules.ts";
import type { CollectorCredential } from "../transport/collector.rest.ts";
import type { TraceIngestSourceBillingService } from "./trace-ingest-source-billing.service.ts";

/** Exactly the API-key directory operations an ingestion door reaches. */
type TraceIngestApiKeys = Pick<ApiKeyApi, "findResolvedToken" | "markUsed">;

/** The one permission an ingestion key is measured against. */
const INGEST_PERMISSION = "traces:create" as const;

/** A resolved ingestion credential and the clock stamp it earns once its body is accepted. */
type TraceIngestResolution = Readonly<{
  resolved: ResolvedApiKeyCredential;
  markUsed: () => void;
}>;

/** The two peers this door reads, and trace's own fold of the source billing fact. */
type TraceIngestCredentialOptions = Readonly<{
  /** Narrowed to what this door calls: it resolves a token and stamps its clock. */
  apiKeys: TraceIngestApiKeys;
  authz: Pick<AuthzApi, "hasApiKeyPermission">;
  sourceBilling: Pick<TraceIngestSourceBillingService, "receiverPolicies">;
  logger?: Pick<Logger, "error"> | undefined;
}>;

export class TraceIngestCredentialService {
  static create(options: TraceIngestCredentialOptions): TraceIngestCredentialService {
    return new TraceIngestCredentialService({
      ...options,
      logger: options.logger ?? createLogger("langwatch:trace:ingest-credential"),
    });
  }

  #apiKeys: TraceIngestApiKeys;
  #authz: Pick<AuthzApi, "hasApiKeyPermission">;
  #sourceBilling: Pick<TraceIngestSourceBillingService, "receiverPolicies">;
  #logger: Pick<Logger, "error">;

  private constructor(
    options: TraceIngestCredentialOptions & Readonly<{ logger: Pick<Logger, "error"> }>,
  ) {
    this.#apiKeys = options.apiKeys;
    this.#authz = options.authz;
    this.#sourceBilling = options.sourceBilling;
    this.#logger = options.logger;
  }

  /** The collector's credential; a refusal is thrown for the door to render. */
  async resolveForCollector(input: { request: Request }): Promise<CollectorCredential> {
    const resolution = await this.#authenticate(input.request);

    return { project: projectOf(resolution.resolved), markUsed: resolution.markUsed };
  }

  /** The receiver's credential, plus the identity it stamps provenance from. */
  async resolveForOtlp(input: OtlpIngestCredentialInput): Promise<OtlpIngestCredential> {
    const { resolved } = await this.#authenticateCredentials(extractTraceIngestCredentials(input));
    const project = projectOf(resolved);

    if (resolved.type !== "apiKey") {
      return {
        project,
        identity: {
          apiKeyId: null,
          organizationId: project.organizationId,
          ingestSourceType: null,
          ingestionTemplateId: null,
        },
      };
    }

    const identity = {
      apiKeyId: resolved.apiKeyId,
      organizationId: resolved.organizationId,
      ingestSourceType: resolved.ingestSourceType,
      ingestionTemplateId: resolved.ingestionTemplateId,
    };
    if (!resolved.ingestSourceType) return { project, identity };
    // Every ingestion-source key is admitted; trace's billing row only decides the marker.
    const policies = await this.#sourceBilling.receiverPolicies({
      organizationId: resolved.organizationId,
      sourceType: resolved.ingestSourceType,
      templateId: resolved.ingestionTemplateId,
    });
    return { project, identity: { ...identity, sourcePolicy: { status: "ready", policies } } };
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
    return this.#authenticateCredentials(extractTraceLegacyRequestCredentials(request));
  }

  async #authenticateCredentials(
    credentials: TraceLegacyRequestCredentials | null,
  ): Promise<TraceIngestResolution> {
    if (!credentials) throw new ProjectMissingCredentialsError();

    const resolved = await this.#apiKeys.findResolvedToken(credentials);
    if (!resolved) throw new ProjectInvalidCredentialsError();

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
      if (!allowed) throw this.#ceilingRefusal(resolved);
    }

    return {
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
