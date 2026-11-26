import type { PiiLevel } from "@langwatch/data-privacy-contract";
import { type EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ConcurrencyLimiter } from "@langwatch/limiter";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import {
  batchCharactersOf,
  PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
  PII_REDACTION_MODEL_FLAG,
} from "../rules/pii-redaction-model.rules.ts";
import {
  clearSplitSpan,
  fitsSpanBudget,
  isPlaceablePiece,
  PII_REDACTION_MODEL_ABORTED_SLOT_HOLD_MS,
  PII_REDACTION_MODEL_SPAN_BUDGET_MS,
  PII_REDACTION_MODEL_SPLIT_SLOTS,
  type PieceAnswer,
  planSpan,
  type SplitCall,
  type SplitPiece,
  splitFindingsCount,
} from "../rules/pii-redaction-split.rules.ts";
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
  findings: number;
  outcome: "ok" | PiiRedactionModelFallbackReason;
  durationMs: number;
  /** A split span only (ADR-207): how many calls it was planned into, sent or not. */
  calls?: number;
  /** On an error only: the failure's class name. */
  errorName?: string;
}>;

const USAGE_MESSAGE = "PII redaction model call";

/** A project's organization, and on self-hosted its licence, is read once per minute. */
const ORGANIZATION_TTL_MS = 60_000;

/** Where a batch goes: the model, Presidio, or Presidio because self-hosted has no licence. */
type Routing =
  | Readonly<{ kind: "model"; organizationId: string }>
  | Readonly<{ kind: "presidio" }>
  | Readonly<{ kind: "not_licensed"; organizationId: string; firstInAMinute: boolean }>;

/**
 * Whether this process sends routed batches to the model. Closed: every batch tries it. Open:
 * none does until `until`; the first batch after that tries it alone and pushes `until` one
 * cool-down on, so a try that never settles cannot keep the model skipped for good.
 */
type ModelBreaker = Readonly<{ kind: "closed" }> | Readonly<{ kind: "open"; until: number }>;

/** How one batch was let through the breaker: as usual, or as the one try after a cool-down. */
type BreakerAdmission = "call" | "probe";

/** The single-call model and the split model trip apart, so long spans never stop short ones. */
type BreakerKind = "single" | "split";

/** How a split span's calls ended: every answer, or the first failure that ends the span. */
type SplitOutcome =
  | Readonly<{ kind: "answered"; answers: PieceAnswer[]; callDurationsMs: number[] }>
  | Readonly<{ kind: "failed"; reason: "timeout" | "throttled" | "error"; error?: unknown }>;

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
 * The PII redaction model, for allowlisted organizations only. Every other batch, and every
 * batch the model fails, is left to today's Presidio-then-DLP path: this never answers a
 * failure with unredacted text or an empty result.
 */
export class PiiRedactionModelService {
  static create(input: {
    model: PresidioRedactionService;
    /** The split model, for pieces of a long batch (ADR-207); absent splits nothing. */
    split?: PresidioRedactionService | undefined;
    /** The process's split call slots; one per process, two by default (ADR-207 decision 9). */
    splitSlots?: ConcurrencyLimiter | undefined;
    featureFlags: FeatureFlagApi;
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

  /** Each project's organization; concurrent batches of one project share one read. */
  readonly #organizations: ProjectLookupCacheService<string>;
  /** Each organization's Enterprise licence, keyed by organization id; self-hosted only. */
  readonly #licences: ProjectLookupCacheService<boolean>;
  /**
   * Per process, not per organization: the model is one deployment for every organization, so
   * when it is slow it is slow for all of them, and a per-organization breaker would pay the
   * time cap once per organization instead of once per process.
   */
  readonly #breakers: Record<BreakerKind, ModelBreaker> = {
    single: { kind: "closed" },
    split: { kind: "closed" },
  };
  private readonly model: PresidioRedactionService;
  private readonly split: PresidioRedactionService | undefined;
  /** Per process: the split calls in flight, the same two slots for every span (decision 9). */
  private readonly splitSlots: ConcurrencyLimiter;
  private readonly featureFlags: FeatureFlagApi;
  private readonly scopes: DataPrivacyProjectScopeService;
  private readonly selfHosted: boolean;
  private readonly entitlements: Pick<EntitlementApi, "getActivePlan">;
  private readonly spend: PiiRedactionSpendService;
  private readonly metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
  private readonly log: UsageLogger;
  private readonly now: () => number;

  private constructor(input: {
    model: PresidioRedactionService;
    split?: PresidioRedactionService | undefined;
    splitSlots?: ConcurrencyLimiter | undefined;
    featureFlags: FeatureFlagApi;
    scopes: DataPrivacyProjectScopeService;
    selfHosted: boolean;
    entitlements: Pick<EntitlementApi, "getActivePlan">;
    spend: PiiRedactionSpendService;
    metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
    log: UsageLogger;
    now: () => number;
  }) {
    this.model = input.model;
    this.split = input.split;
    this.splitSlots =
      input.splitSlots ??
      new ConcurrencyLimiter({ maxConcurrent: PII_REDACTION_MODEL_SPLIT_SLOTS, maxQueued: 0 });
    this.featureFlags = input.featureFlags;
    this.scopes = input.scopes;
    this.selfHosted = input.selfHosted;
    this.entitlements = input.entitlements;
    this.spend = input.spend;
    this.metrics = input.metrics;
    this.log = input.log;
    this.now = input.now;
    this.#organizations = ProjectLookupCacheService.create<string>({
      ttlMs: ORGANIZATION_TTL_MS,
      now: input.now,
    });
    this.#licences = ProjectLookupCacheService.create<boolean>({
      ttlMs: ORGANIZATION_TTL_MS,
      now: input.now,
    });
  }

  /** The model's clearing of one batch, or null when the batch stays on Presidio. */
  async findClearing(input: ModelClearInput): Promise<(string | null)[] | null> {
    // A custom level, or a policy that could not be resolved, stays on Presidio exactly as
    // today: the request's own level says STRICT for both, so only the effective one counts.
    if (input.effectivePiiLevel !== "strict") return null;
    const projectId = input.projectId;
    if (!projectId) return null;
    const routing = await this.#routingOf({ projectId });
    if (routing.kind === "presidio") return null;

    const call = {
      organizationId: routing.organizationId,
      projectId,
      texts: input.texts.length,
      characters: batchCharactersOf(input.texts),
    };
    if (routing.kind === "not_licensed") {
      this.metrics.modelFellBack("not_licensed");
      if (routing.firstInAMinute) {
        this.log.info(
          { ...call, findings: 0, outcome: "not_licensed", durationMs: 0 },
          USAGE_MESSAGE,
        );
      }
      return null;
    }
    const { organizationId } = routing;
    const plan = planSpan({ texts: input.texts, splitting: await this.#isSplitting() });
    if (plan.kind === "too_long") {
      this.metrics.modelFellBack("too_long");
      this.log.info({ ...call, findings: 0, outcome: "too_long", durationMs: 0 }, USAGE_MESSAGE);
      return null;
    }
    if (plan.kind === "split") {
      return this.#clearSplit({ input, organizationId, projectId, call, calls: plan.calls });
    }

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

  /** Whether a split model is set: asked of its channel once, like the model's. */
  async #isSplitting(): Promise<boolean> {
    if (!this.split) return false;
    try {
      return await this.split.isConfigured();
    } catch {
      return false;
    }
  }

  /**
   * A long batch through the split model (ADR-207): the free slots taken at once, never waited
   * for; one 50 s budget for every call; the first failure sends the whole span to Presidio.
   */
  async #clearSplit({
    input,
    organizationId,
    projectId,
    call,
    calls,
  }: {
    input: ModelClearInput;
    organizationId: string;
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
    const slots = Math.min(
      PII_REDACTION_MODEL_SPLIT_SLOTS - this.splitSlots.stats().inFlight,
      calls.length,
    );
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
    const outcome = await this.#runSplitCalls({ input, calls, slots, onUnavailable });
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
    });
    return cleared;
  }

  /**
   * The span's calls over `slots` slots it takes now, each slot running calls one after another.
   * Resolves at the first failure or the budget's end; calls still running finish on their own.
   */
  #runSplitCalls({
    input,
    calls,
    slots,
    onUnavailable,
  }: {
    input: ModelClearInput;
    calls: readonly SplitCall[];
    slots: number;
    onUnavailable: () => void;
  }): Promise<SplitOutcome> {
    const split = this.split;
    if (!split) return Promise.resolve({ kind: "failed", reason: "error" });
    const abort = new AbortController();
    return new Promise<SplitOutcome>((resolve) => {
      const run: SplitRun = {
        calls,
        next: 0,
        answers: [],
        callDurationsMs: [],
        ended: false,
        onUnavailable,
        answer: (splitCall) =>
          split.answers({
            texts: splitCall.pieces.map((piece) => pieceTextOf({ texts: input.texts, piece })),
            piiRedactionLevel: input.piiRedactionLevel,
            entities: input.entities,
            projectId: input.projectId,
            signal: abort.signal,
          }),
        end: (outcome) => {
          if (run.ended) return;
          run.ended = true;
          clearTimeout(budget);
          if (outcome.kind === "failed" && outcome.reason === "timeout") abort.abort();
          resolve(outcome);
        },
      };
      const budget = setTimeout(
        () => run.end({ kind: "failed", reason: "timeout" }),
        PII_REDACTION_MODEL_SPAN_BUDGET_MS,
      );
      for (let slot = 0; slot < slots; slot++) {
        void this.splitSlots.run({ task: () => runSplitSlot(run) }).catch(() => void 0);
      }
    });
  }

  /** Whether a batch may call the model now, and how; null while the breaker is open. */
  #admit(kind: BreakerKind): BreakerAdmission | null {
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
    kind: BreakerKind;
    admission: BreakerAdmission;
    unavailable: boolean;
  }): void {
    if (unavailable) this.#openBreaker(kind);
    else if (admission === "probe") this.#breakers[kind] = { kind: "closed" };
  }

  #openBreaker(kind: BreakerKind): void {
    this.#breakers[kind] = {
      kind: "open",
      until: this.now() + PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
    };
  }

  /**
   * Where the project's batches go. Configured first, so a deployment naming no model never asks
   * the flag or the database; the licence last, so Cloud and an off flag never read the plan.
   */
  async #routingOf({ projectId }: { projectId: string }): Promise<Routing> {
    try {
      if (!(await this.model.isConfigured())) return { kind: "presidio" };

      const organizationId = await this.#organizationOf({ projectId });
      const routed = await this.featureFlags.isEnabled(PII_REDACTION_MODEL_FLAG, {
        kind: "project",
        projectId,
        organizationId,
      });
      if (!routed) return { kind: "presidio" };
      if (!this.selfHosted) return { kind: "model", organizationId };

      const { licensed, firstInAMinute } = await this.#licenceOf({ organizationId });
      return licensed
        ? { kind: "model", organizationId }
        : { kind: "not_licensed", organizationId, firstInAMinute };
    } catch (error) {
      this.metrics.modelFellBack("routing_error");
      logger.warn(
        { projectId, reason: failureName(error) },
        "PII redaction model routing could not be decided; using Presidio",
      );
      return { kind: "presidio" };
    }
  }

  /** Whether the organization holds an Enterprise licence, and whether this read asked for it. */
  async #licenceOf({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ licensed: boolean; firstInAMinute: boolean }> {
    let firstInAMinute = false;
    const licensed = await this.#licences.get(organizationId, async () => {
      firstInAMinute = true;
      const plan = await this.entitlements.getActivePlan({ organizationId });
      return isEnterpriseTier(plan.type);
    });
    return { licensed, firstInAMinute };
  }

  #organizationOf({ projectId }: { projectId: string }): Promise<string> {
    return this.#organizations.get(projectId, async () => {
      const { organizationId } = await this.scopes.getScopeFacts({ projectId });
      return organizationId;
    });
  }
}

/** One split span's calls as its slots share them. */
type SplitRun = {
  readonly calls: readonly SplitCall[];
  next: number;
  readonly answers: PieceAnswer[];
  readonly callDurationsMs: number[];
  ended: boolean;
  readonly answer: (call: SplitCall) => Promise<{ findings: unknown; anonymized: unknown }[]>;
  readonly end: (outcome: SplitOutcome) => void;
  /** A call timed out or was throttled, even after the span ended: the breaker must hear it. */
  readonly onUnavailable: () => void;
};

function pieceTextOf({ texts, piece }: { texts: readonly string[]; piece: SplitPiece }): string {
  return (texts[piece.text] ?? "").slice(piece.start, piece.end);
}

/** One slot: the span's next call until none is left, the span ended or a call failed. */
async function runSplitSlot(run: SplitRun): Promise<void> {
  while (!run.ended && run.next < run.calls.length) {
    const splitCall = run.calls[run.next++];
    if (!splitCall || !(await runSplitCall({ run, splitCall }))) return;
  }
}

/**
 * One call; false when it failed. A call our abort rejected keeps its slot until the model's
 * own deadline has passed, so the slots never count as free what the model may still run.
 */
async function runSplitCall({
  run,
  splitCall,
}: {
  run: SplitRun;
  splitCall: SplitCall;
}): Promise<boolean> {
  // Monotonic, as the single call's: a wall-clock step never makes a duration or a hold wrong.
  const startedAt = performance.now();
  try {
    const answered = await run.answer(splitCall);
    run.callDurationsMs.push(elapsedSince(startedAt));
    for (const [i, piece] of splitCall.pieces.entries()) {
      const answer = answered[i];
      // A missing answer fails the span: a default of no findings would store the piece raw.
      if (!answer) throw new Error("PII redaction split model left a piece unanswered");
      run.answers.push({ piece, ...answer });
    }
    if (run.callDurationsMs.length === run.calls.length) {
      run.end({ kind: "answered", answers: run.answers, callDurationsMs: run.callDurationsMs });
    }
    return true;
  } catch (error) {
    const reason = failureOutcomeOf(error);
    if (reason !== "error") run.onUnavailable();
    run.end({ kind: "failed", reason, error });
    const holdMs = startedAt + PII_REDACTION_MODEL_ABORTED_SLOT_HOLD_MS - performance.now();
    if (reason === "timeout" && holdMs > 0) await new Promise((wake) => setTimeout(wake, holdMs));
    return false;
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
