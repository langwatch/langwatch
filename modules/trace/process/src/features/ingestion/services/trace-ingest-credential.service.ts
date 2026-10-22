/**
 * The project credential both ingestion doors (SDK collector, OTLP
 * receiver) resolve for themselves. One resolution, refused by throwing;
 * each door renders the refusal in its own vocabulary.
 */
import { createHash } from "node:crypto";

import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "@langwatch/api";
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, createWarnThrottle, type Logger } from "@langwatch/observability";
import type { OtlpIngestCredential, OtlpIngestCredentialInput } from "@langwatch/otlp/door";

import type { CollectorCredential } from "../../../transport/collector.rest.ts";
import {
  extractTraceIngestCredentials,
  extractTraceLegacyRequestCredentials,
  type TraceLegacyRequestCredentials,
} from "../rules/trace-request-credentials.rules.ts";
import type { TraceIngestSourceBillingService } from "./trace-ingest-source-billing.service.ts";

/** Exactly the API-key directory operations an ingestion door reaches. */
type TraceIngestApiKeys = Pick<ApiKeyApi, "findResolvedToken" | "markUsed">;

/** The one permission an ingestion key is measured against. */
const INGEST_PERMISSION = "traces:create" as const;

/**
 * One ceiling-refusal line per key per window. A misconfigured exporter retries
 * its refused batch many times a second, and every retry is the same fact.
 */
const CEILING_REFUSAL_LOG_WINDOW_MS = 5 * 60_000;

/**
 * How long a token the directory did not know stays refused without asking it again. A
 * misconfigured exporter resends the same bad key many times a second; each repeat otherwise
 * costs a directory lookup. Short, so a key created a moment ago is not locked out for long.
 */
const UNKNOWN_TOKEN_TTL_MS = 10_000;

/** The most unknown tokens remembered at once; the oldest is forgotten first, bounding memory. */
const UNKNOWN_TOKEN_MAX_ENTRIES = 2_000;

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
  logger?: Pick<Logger, "warn"> | undefined;
  /** The clock the refusal log samples against. */
  now?: (() => number) | undefined;
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
  #logger: Pick<Logger, "warn">;
  #now: () => number;
  #refusalLog = createWarnThrottle(CEILING_REFUSAL_LOG_WINDOW_MS);
  /** Digest of an unknown token and its project, to when the refusal stops being remembered. */
  #unknownTokens = new Map<string, number>();

  private constructor(
    options: TraceIngestCredentialOptions & Readonly<{ logger: Pick<Logger, "warn"> }>,
  ) {
    this.#apiKeys = options.apiKeys;
    this.#authz = options.authz;
    this.#sourceBilling = options.sourceBilling;
    this.#logger = options.logger;
    this.#now = options.now ?? Date.now;
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

    const unknownKey = unknownTokenKey(credentials);
    if (this.#isRememberedUnknown(unknownKey)) throw new ProjectInvalidCredentialsError();

    const resolved = await this.#apiKeys.findResolvedToken(credentials);
    if (!resolved) {
      this.#rememberUnknown(unknownKey);
      throw new ProjectInvalidCredentialsError();
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
      if (!allowed) throw this.#ceilingRefusal(resolved);
    }

    return {
      resolved,
      markUsed: () => {
        if (resolved.type === "apiKey") this.#apiKeys.markUsed({ id: resolved.apiKeyId });
      },
    };
  }

  #isRememberedUnknown(key: string): boolean {
    const expiresAt = this.#unknownTokens.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt > this.#now()) return true;
    this.#unknownTokens.delete(key);
    return false;
  }

  #rememberUnknown(key: string): void {
    this.#unknownTokens.delete(key);
    this.#unknownTokens.set(key, this.#now() + UNKNOWN_TOKEN_TTL_MS);
    if (this.#unknownTokens.size > UNKNOWN_TOKEN_MAX_ENTRIES) {
      const oldest = this.#unknownTokens.keys().next();
      if (!oldest.done) this.#unknownTokens.delete(oldest.value);
    }
  }

  /** The sender's own key configuration: a customer fault, logged as a warning, sampled per key. */
  #ceilingRefusal(resolved: Extract<ResolvedApiKeyCredential, { type: "apiKey" }>): HandledError {
    const suppressedRefusals = this.#refusalLog.claim({
      key: resolved.apiKeyId,
      now: this.#now(),
    });
    if (suppressedRefusals !== undefined) {
      this.#logger.warn(
        {
          apiKeyId: resolved.apiKeyId,
          userId: resolved.userId ?? null,
          projectId: resolved.project.id,
          permission: INGEST_PERMISSION,
          suppressedRefusals,
        },
        "API key ceiling denial",
      );
    }
    return new ApiKeyPermissionDeniedError(INGEST_PERMISSION);
  }
}

/** The memory key of a refused token: a digest, so the token itself is never held. */
function unknownTokenKey(credentials: TraceLegacyRequestCredentials): string {
  return createHash("sha256")
    .update(credentials.projectId ?? "")
    .update("\0")
    .update(credentials.token)
    .digest("base64");
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
