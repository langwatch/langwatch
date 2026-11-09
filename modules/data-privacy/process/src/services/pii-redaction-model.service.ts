import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import { batchCharactersOf, PII_REDACTION_MODEL_FLAG } from "../rules/pii-redaction-model.rules.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";
import type {
  PiiAnalysisMetricsOtelService,
  PiiRedactionModelFallbackReason,
} from "./pii-analysis-metrics-otel.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-model");

/** Where the usage line goes: the module's logger, or a recorder in a test. */
type UsageLogger = {
  info(fields: PiiRedactionModelUsage, message: string): void;
  warn(fields: PiiRedactionModelUsage, message: string): void;
};

/**
 * The one usage line a batch routed to the model leaves. Counts and ids only: never a text,
 * never a finding's value, never an error message (it may quote the text).
 */
export type PiiRedactionModelUsage = Readonly<{
  organizationId: string;
  projectId: string;
  texts: number;
  characters: number;
  spansFound: number;
  outcome: "ok" | PiiRedactionModelFallbackReason;
  durationMs: number;
  /** On an error only: the failure's class name. */
  errorName?: string;
}>;

const USAGE_MESSAGE = "PII redaction model call";

/** A project's organization is read once per minute, as its privacy policy is. */
const ORGANIZATION_TTL_MS = 60_000;

/** One strict-analysis batch, as the redaction pass hands it to Presidio. */
type ModelClearInput = {
  texts: readonly string[];
  piiRedactionLevel: PIIRedactionLevel;
  entities?: readonly string[] | undefined;
  projectId?: string | undefined;
  spareNamesAndPlaces?: readonly boolean[] | undefined;
};

/**
 * The PII redaction model, for allowlisted organizations only. Every other batch, and every
 * batch the model fails, is left to today's Presidio-then-DLP path: this never answers a
 * failure with unredacted text or an empty result.
 */
export class PiiRedactionModelService {
  static create(input: {
    model: PresidioRedactionService;
    featureFlags: FeatureFlagApi;
    scopes: DataPrivacyProjectScopeService;
    metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
    log?: UsageLogger;
    now?: () => number;
  }): PiiRedactionModelService {
    return new PiiRedactionModelService({
      ...input,
      log: input.log ?? logger,
      now: input.now ?? (() => nowInstant().epochMilliseconds),
    });
  }

  readonly #organizations = new Map<string, { organizationId: string; expiresAt: number }>();
  private readonly model: PresidioRedactionService;
  private readonly featureFlags: FeatureFlagApi;
  private readonly scopes: DataPrivacyProjectScopeService;
  private readonly metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
  private readonly log: UsageLogger;
  private readonly now: () => number;

  private constructor(input: {
    model: PresidioRedactionService;
    featureFlags: FeatureFlagApi;
    scopes: DataPrivacyProjectScopeService;
    metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
    log: UsageLogger;
    now: () => number;
  }) {
    this.model = input.model;
    this.featureFlags = input.featureFlags;
    this.scopes = input.scopes;
    this.metrics = input.metrics;
    this.log = input.log;
    this.now = input.now;
  }

  /** The model's clearing of one batch, or null when the batch stays on Presidio. */
  async findClearing(input: ModelClearInput): Promise<(string | null)[] | null> {
    const projectId = input.projectId;
    if (!projectId) return null;
    const organizationId = await this.#routedOrganizationOf({ projectId });
    if (!organizationId) return null;

    const call = {
      organizationId,
      projectId,
      texts: input.texts.length,
      characters: batchCharactersOf(input.texts),
    };

    const startedAt = performance.now();
    try {
      const { cleared, findings } = await this.model.clearCounting(input);
      this.log.info(
        { ...call, spansFound: findings, outcome: "ok", durationMs: elapsedSince(startedAt) },
        USAGE_MESSAGE,
      );
      return cleared;
    } catch (error) {
      const outcome = isTimeout(error) ? "timeout" : "error";
      this.metrics.modelFellBack(outcome);
      this.log.warn(
        {
          ...call,
          spansFound: 0,
          outcome,
          durationMs: elapsedSince(startedAt),
          errorName: failureName(error),
        },
        USAGE_MESSAGE,
      );
      return null;
    }
  }

  /**
   * The project's organization when its batches go to the model, else null. Configured first,
   * so a deployment naming no model never asks the flag or the database.
   */
  async #routedOrganizationOf({ projectId }: { projectId: string }): Promise<string | null> {
    try {
      if (!(await this.model.isConfigured())) return null;

      const organizationId = await this.#organizationOf({ projectId });
      const routed = await this.featureFlags.isEnabled(PII_REDACTION_MODEL_FLAG, {
        kind: "project",
        projectId,
        organizationId,
      });
      return routed ? organizationId : null;
    } catch (error) {
      this.metrics.modelFellBack("routing_error");
      logger.warn(
        { projectId, reason: failureName(error) },
        "PII redaction model routing could not be decided; using Presidio",
      );
      return null;
    }
  }

  async #organizationOf({ projectId }: { projectId: string }): Promise<string> {
    const cached = this.#organizations.get(projectId);
    if (cached && cached.expiresAt > this.now()) return cached.organizationId;

    const { organizationId } = await this.scopes.getScopeFacts({ projectId });
    this.#organizations.set(projectId, {
      organizationId,
      expiresAt: this.now() + ORGANIZATION_TTL_MS,
    });
    return organizationId;
  }
}

/** The failure's class name only: a refusal's message may quote the analysed text. */
function failureName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** An abort at the time cap: the Lambda SDK and fetch both name it AbortError. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
