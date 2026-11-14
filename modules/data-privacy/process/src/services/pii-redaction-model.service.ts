import type { PiiLevel } from "@langwatch/data-privacy-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import {
  batchCharactersOf,
  isBatchTooLongForModel,
  PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
  PII_REDACTION_MODEL_FLAG,
} from "../rules/pii-redaction-model.rules.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";
import type {
  PiiAnalysisMetricsOtelService,
  PiiRedactionModelFallbackReason,
} from "./pii-analysis-metrics-otel.service.ts";
import type { PiiRedactionSpendService } from "./pii-redaction-spend.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";
import { ProjectLookupCacheService } from "./project-lookup-cache.service.ts";

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

/**
 * Whether this process sends routed batches to the model. Closed: every batch tries it. Open:
 * none does until `until`; the first batch after that tries it alone and pushes `until` one
 * cool-down on, so a try that never settles cannot keep the model skipped for good.
 */
type ModelBreaker = Readonly<{ kind: "closed" }> | Readonly<{ kind: "open"; until: number }>;

/** How one batch was let through the breaker: as usual, or as the one try after a cool-down. */
type BreakerAdmission = "call" | "probe";

/** One strict-analysis batch, as the redaction pass hands it to Presidio. */
type ModelClearInput = {
  texts: readonly string[];
  piiRedactionLevel: PIIRedactionLevel;
  entities?: readonly string[] | undefined;
  projectId?: string | undefined;
  /** The level of the tenant's resolved policy; absent when none was resolved. */
  resolvedPiiLevel?: PiiLevel | undefined;
  spareNamesAndPlaces?: readonly boolean[] | undefined;
  /** The record's trace and span, when it has them; its spend request id is derived from it. */
  recordKey?: string | undefined;
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
    spend: PiiRedactionSpendService;
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

  /** Each project's organization; concurrent batches of one project share one read. */
  readonly #organizations: ProjectLookupCacheService<string>;
  /**
   * Per process, not per organization: the model is one deployment for every organization, so
   * when it is slow it is slow for all of them, and a per-organization breaker would pay the
   * time cap once per organization instead of once per process.
   */
  #breaker: ModelBreaker = { kind: "closed" };
  private readonly model: PresidioRedactionService;
  private readonly featureFlags: FeatureFlagApi;
  private readonly scopes: DataPrivacyProjectScopeService;
  private readonly spend: PiiRedactionSpendService;
  private readonly metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
  private readonly log: UsageLogger;
  private readonly now: () => number;

  private constructor(input: {
    model: PresidioRedactionService;
    featureFlags: FeatureFlagApi;
    scopes: DataPrivacyProjectScopeService;
    spend: PiiRedactionSpendService;
    metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
    log: UsageLogger;
    now: () => number;
  }) {
    this.model = input.model;
    this.featureFlags = input.featureFlags;
    this.scopes = input.scopes;
    this.spend = input.spend;
    this.metrics = input.metrics;
    this.log = input.log;
    this.now = input.now;
    this.#organizations = ProjectLookupCacheService.create<string>({
      ttlMs: ORGANIZATION_TTL_MS,
      now: input.now,
    });
  }

  /** The model's clearing of one batch, or null when the batch stays on Presidio. */
  async findClearing(input: ModelClearInput): Promise<(string | null)[] | null> {
    // A custom level, or a policy that could not be resolved, stays on Presidio exactly as
    // today: the request's own level says STRICT for both, so only the resolved one counts.
    if (input.resolvedPiiLevel !== "strict") return null;
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
    if (isBatchTooLongForModel(input.texts)) {
      this.metrics.modelFellBack("too_long");
      this.log.info({ ...call, spansFound: 0, outcome: "too_long", durationMs: 0 }, USAGE_MESSAGE);
      return null;
    }

    const admission = this.#admit();
    if (!admission) {
      this.metrics.modelFellBack("breaker_open");
      this.log.info(
        { ...call, spansFound: 0, outcome: "breaker_open", durationMs: 0 },
        USAGE_MESSAGE,
      );
      return null;
    }

    const startedAt = performance.now();
    try {
      const { cleared, findings } = await this.model.clearCounting(input);
      const durationMs = elapsedSince(startedAt);
      this.#settle({ admission, unavailable: false });
      this.log.info({ ...call, spansFound: findings, outcome: "ok", durationMs }, USAGE_MESSAGE);
      await this.spend.record({
        organizationId,
        projectId,
        texts: input.texts,
        recordKey: input.recordKey,
        durationMs,
      });
      return cleared;
    } catch (error) {
      const outcome = failureOutcomeOf(error);
      this.#settle({ admission, unavailable: outcome !== "error" });
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

  /** Whether a batch may call the model now, and how; null while the breaker is open. */
  #admit(): BreakerAdmission | null {
    const breaker = this.#breaker;
    if (breaker.kind === "closed") return "call";
    if (this.now() < breaker.until) return null;
    this.#openBreaker();
    return "probe";
  }

  /**
   * A timeout or a throttle opens the breaker, whichever batch saw it. Only the probe closes it:
   * a batch that set off before the breaker opened and answers late says nothing about now. Any
   * other answer to the probe, even a refusal, shows the model is reachable in time.
   */
  #settle({ admission, unavailable }: { admission: BreakerAdmission; unavailable: boolean }): void {
    if (unavailable) this.#openBreaker();
    else if (admission === "probe") this.#breaker = { kind: "closed" };
  }

  #openBreaker(): void {
    this.#breaker = { kind: "open", until: this.now() + PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS };
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

  #organizationOf({ projectId }: { projectId: string }): Promise<string> {
    return this.#organizations.get(projectId, async () => {
      const { organizationId } = await this.scopes.getScopeFacts({ projectId });
      return organizationId;
    });
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

/** A timeout or a throttle means the model is unavailable now; anything else is a refusal. */
function failureOutcomeOf(error: unknown): "timeout" | "throttled" | "error" {
  if (isTimeout(error)) return "timeout";
  if (isThrottled(error)) return "throttled";
  return "error";
}

/** Lambda's own throttle, which the SDK names after the error code since it is not retried. */
function isThrottled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TooManyRequestsException" || error.name === "ThrottlingException")
  );
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
