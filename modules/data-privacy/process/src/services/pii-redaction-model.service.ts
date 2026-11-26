import type { PiiLevel } from "@langwatch/data-privacy-contract";
import { PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ConcurrencyLimiter } from "@langwatch/limiter";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import {
  batchCharactersOf,
  failureName,
  failureOutcomeOf,
  PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
  type ModelCallContext,
  PII_REDACTION_MODEL_SPLIT_FLAG,
} from "../rules/pii-redaction-model.rules.ts";
import {
  clearSplitSpan,
  fitsSpanBudget,
  isPlaceablePiece,
  pieceTextOf,
  planSpan,
  type SplitCall,
  splitFindingsCount,
} from "../rules/pii-redaction-split.rules.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";
import type {
  PiiAnalysisMetricsOtelService,
  PiiRedactionModelFallbackReason,
} from "./pii-analysis-metrics-otel.service.ts";
import { PiiRedactionModelRoutingService } from "./pii-redaction-model-routing.service.ts";
import type { PiiRedactionSpendService } from "./pii-redaction-spend.service.ts";
import { PiiRedactionSplitCallsService } from "./pii-redaction-split-calls.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-model");

/** A routing read that failed, so the batch took the safe path. */
type RoutingWarning = { projectId: string; reason: string };

/** Where the usage line and routing warnings go: the module's logger, or a recorder in a test. */
type UsageLogger = {
  info(fields: PiiRedactionModelUsage, message: string): void;
  warn(fields: PiiRedactionModelUsage | RoutingWarning, message: string): void;
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
  findings: number;
  outcome: "ok" | PiiRedactionModelFallbackReason;
  durationMs: number;
  /** A split span only (ADR-207): how many calls it was planned into, sent or not. */
  calls?: number;
  /** On an error only: the failure's class name. */
  errorName?: string;
}>;

const USAGE_MESSAGE = "PII redaction model call";

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
  /** The level in force (policy reconciled with the request); absent when none was resolved. */
  effectivePiiLevel?: PiiLevel | undefined;
  spareNamesAndPlaces?: readonly boolean[] | undefined;
  /** The record's trace and span, when it has them; its spend request id is derived from it. */
  recordKey?: string | undefined;
};

/**
 * The PII redaction model, for allowlisted organizations; on Cloud only for the free list or once
 * an admin accepted its price. Every other batch, and every failed one, is left to Presidio then
 * DLP: this never answers a failure with unredacted text or an empty result.
 */
export class PiiRedactionModelService {
  static create(input: {
    model: PresidioRedactionService;
    /** The process's split call slots; one per process, two by default (ADR-207 decision 9). */
    splitSlots?: ConcurrencyLimiter | undefined;
    featureFlags: FeatureFlagApi;
    /** Whether an organization admin accepted the model's price, which Cloud needs (ADR-201). */
    organizations: Pick<OrganizationApi, "isPiiRedactionModelAccepted">;
    scopes: DataPrivacyProjectScopeService;
    /** Self-hosted, the model comes with the Enterprise license; Cloud prices it. */
    selfHosted: boolean;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
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

  /**
   * Per process, not per organization: the model is one deployment for every organization, so
   * when it is slow it is slow for all of them, and a per-organization breaker would pay the
   * time cap once per organization instead of once per process.
   */
  readonly #breakers: Record<ModelCallContext, ModelBreaker> = {
    single: { kind: "closed" },
    split: { kind: "closed" },
  };
  private readonly model: PresidioRedactionService;
  /** The model's split calls over the process's split slots (ADR-207). */
  private readonly splitCalls: PiiRedactionSplitCallsService;
  /** Where each project's batches go: the model, priced or not, or Presidio. */
  private readonly routing: PiiRedactionModelRoutingService;
  private readonly featureFlags: FeatureFlagApi;
  private readonly spend: PiiRedactionSpendService;
  private readonly metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
  private readonly log: UsageLogger;
  private readonly now: () => number;

  private constructor(input: {
    model: PresidioRedactionService;
    splitSlots?: ConcurrencyLimiter | undefined;
    featureFlags: FeatureFlagApi;
    organizations: Pick<OrganizationApi, "isPiiRedactionModelAccepted">;
    scopes: DataPrivacyProjectScopeService;
    selfHosted: boolean;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    spend: PiiRedactionSpendService;
    metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
    log: UsageLogger;
    now: () => number;
  }) {
    this.model = input.model;
    this.splitCalls = PiiRedactionSplitCallsService.create({
      model: input.model,
      slots: input.splitSlots,
    });
    this.routing = PiiRedactionModelRoutingService.create(input);
    this.featureFlags = input.featureFlags;
    this.spend = input.spend;
    this.metrics = input.metrics;
    this.log = input.log;
    this.now = input.now;
  }

  /** The model's clearing of one batch, or null when the batch stays on Presidio. */
  async findClearing(input: ModelClearInput): Promise<(string | null)[] | null> {
    // A custom level, or a policy that could not be resolved, stays on Presidio exactly as
    // today: the request's own level says STRICT for both, so only the effective one counts.
    if (input.effectivePiiLevel !== "strict") return null;
    const projectId = input.projectId;
    if (!projectId) return null;
    const routing = await this.routing.routingOf({ projectId });
    if (routing.kind === "presidio") return null;

    const call = {
      organizationId: routing.organizationId,
      projectId,
      texts: input.texts.length,
      characters: batchCharactersOf(input.texts),
    };
    if (routing.kind === "not_licensed" || routing.kind === "not_accepted") {
      this.metrics.modelFellBack(routing.kind);
      if (routing.firstInAMinute) {
        this.log.info(
          { ...call, findings: 0, outcome: routing.kind, durationMs: 0 },
          USAGE_MESSAGE,
        );
      }
      return null;
    }
    const { organizationId, priced } = routing;
    // Only a batch too long for one call asks whether it may split.
    const splitting =
      call.characters > PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS &&
      (await this.#isSplitting({ organizationId, projectId }));
    const plan = planSpan({ texts: input.texts, splitting });
    if (plan.kind === "too_long") {
      this.metrics.modelFellBack("too_long");
      this.log.info({ ...call, findings: 0, outcome: "too_long", durationMs: 0 }, USAGE_MESSAGE);
      return null;
    }
    if (plan.kind === "split") {
      return this.#clearSplit({
        input,
        organizationId,
        priced,
        projectId,
        call,
        calls: plan.calls,
      });
    }
    return this.#clearSingle({ input, organizationId, priced, projectId, call });
  }

  /** A batch of 8,000 characters or less in one call, as before ADR-207. */
  async #clearSingle({
    input,
    organizationId,
    priced,
    projectId,
    call,
  }: {
    input: ModelClearInput;
    organizationId: string;
    /** As routing priced the batch; never read again after the call. */
    priced: boolean;
    projectId: string;
    call: Omit<PiiRedactionModelUsage, "findings" | "outcome" | "durationMs">;
  }): Promise<(string | null)[] | null> {
    const admission = this.#admit("single");
    if (!admission) {
      this.metrics.modelFellBack("breaker_open");
      this.log.info(
        { ...call, findings: 0, outcome: "breaker_open", durationMs: 0 },
        USAGE_MESSAGE,
      );
      return null;
    }

    const startedAt = performance.now();
    try {
      const { cleared, findings } = await this.model.clearCounting(input);
      const durationMs = elapsedSince(startedAt);
      this.#settle({ kind: "single", admission, unavailable: false });
      this.log.info({ ...call, findings, outcome: "ok", durationMs }, USAGE_MESSAGE);
      await this.spend.record({
        organizationId,
        projectId,
        texts: input.texts,
        recordKey: input.recordKey,
        callDurationsMs: [durationMs],
        priced,
      });
      return cleared;
    } catch (error) {
      const outcome = failureOutcomeOf(error);
      this.#settle({ kind: "single", admission, unavailable: outcome !== "error" });
      this.metrics.modelFellBack(outcome);
      this.log.warn(
        {
          ...call,
          findings: 0,
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
   * A long batch through split calls to the model (ADR-207): the free slots taken at once, never
   * waited for; one 50 s budget for every call; the first failure sends the whole span to Presidio.
   */
  async #clearSplit({
    input,
    organizationId,
    priced,
    projectId,
    call,
    calls,
  }: {
    input: ModelClearInput;
    organizationId: string;
    /** As routing priced the batch; never read again after the calls. */
    priced: boolean;
    projectId: string;
    call: Omit<PiiRedactionModelUsage, "findings" | "outcome" | "durationMs">;
    calls: readonly SplitCall[];
  }): Promise<(string | null)[] | null> {
    const fallBack = (
      outcome: Exclude<PiiRedactionModelUsage["outcome"], "ok">,
      durationMs = 0,
    ) => {
      this.metrics.modelFellBack(outcome);
      this.log.info(
        { ...call, findings: 0, outcome, durationMs, calls: calls.length },
        USAGE_MESSAGE,
      );
      return null;
    };
    const placeable = calls
      .flatMap((c) => c.pieces)
      .filter((piece) => !piece.whole)
      .every((p) => isPlaceablePiece(pieceTextOf({ texts: input.texts, piece: p })));
    if (!placeable) return fallBack("unplaceable");
    const slots = Math.min(this.splitCalls.freeSlots(), calls.length);
    if (slots < 1 || !fitsSpanBudget({ calls, slots })) return fallBack("busy");
    const admission = this.#admit("split");
    if (!admission) return fallBack("breaker_open");

    const startedAt = performance.now();
    // A sibling's timeout or throttle after the span ended still opens the breaker.
    const late = { settled: false, unavailable: false };
    const onUnavailable = () => {
      late.unavailable = true;
      if (late.settled) this.#openBreaker("split");
    };
    const outcome = await this.splitCalls.run({ input, calls, slots, onUnavailable });
    const durationMs = elapsedSince(startedAt);
    late.settled = true;
    if (outcome.kind === "failed") {
      const unavailable = outcome.reason !== "error" || late.unavailable;
      this.#settle({ kind: "split", admission, unavailable });
      this.metrics.modelFellBack(outcome.reason);
      this.log.warn(
        {
          ...call,
          findings: 0,
          outcome: outcome.reason,
          durationMs,
          calls: calls.length,
          ...(outcome.error === undefined ? {} : { errorName: failureName(outcome.error) }),
        },
        USAGE_MESSAGE,
      );
      return null;
    }
    this.#settle({ kind: "split", admission, unavailable: false });
    const cleared = clearSplitSpan({
      texts: input.texts,
      answers: outcome.answers,
      spareNamesAndPlaces: input.spareNamesAndPlaces,
    });
    if (cleared === "unplaceable") return fallBack("unplaceable", durationMs);
    const findings = splitFindingsCount({ texts: input.texts, answers: outcome.answers });
    this.log.info(
      { ...call, findings, outcome: "ok", durationMs, calls: calls.length },
      USAGE_MESSAGE,
    );
    await this.spend.record({
      organizationId,
      projectId,
      texts: input.texts,
      recordKey: input.recordKey,
      callDurationsMs: outcome.callDurationsMs,
      priced,
    });
    return cleared;
  }

  /** Whether a batch may call the model now, and how; null while the breaker is open. */
  #admit(kind: ModelCallContext): BreakerAdmission | null {
    const breaker = this.#breakers[kind];
    if (breaker.kind === "closed") return "call";
    if (this.now() < breaker.until) return null;
    this.#openBreaker(kind);
    return "probe";
  }

  /**
   * A timeout or a throttle opens the breaker, whichever batch saw it. Only the probe closes it:
   * a batch that set off before the breaker opened and answers late says nothing about now. Any
   * other answer to the probe, even a refusal, shows the model is reachable in time.
   */
  #settle({
    kind,
    admission,
    unavailable,
  }: {
    kind: ModelCallContext;
    admission: BreakerAdmission;
    unavailable: boolean;
  }): void {
    if (unavailable) this.#openBreaker(kind);
    else if (admission === "probe") this.#breakers[kind] = { kind: "closed" };
  }

  #openBreaker(kind: ModelCallContext): void {
    this.#breakers[kind] = {
      kind: "open",
      until: this.now() + PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
    };
  }

  /** Whether this batch may split: a channel that takes split calls, and the org's split flag. */
  async #isSplitting({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }): Promise<boolean> {
    if (!this.splitCalls.canSplit()) return false;
    try {
      return await this.featureFlags.isEnabled(PII_REDACTION_MODEL_SPLIT_FLAG, {
        kind: "project",
        projectId,
        organizationId,
      });
    } catch (error) {
      this.log.warn(
        { projectId, reason: failureName(error) },
        "PII redaction model split flag could not be read; not splitting",
      );
      return false;
    }
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
