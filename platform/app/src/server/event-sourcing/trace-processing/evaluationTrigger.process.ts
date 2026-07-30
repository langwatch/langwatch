import crypto from "node:crypto";
import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";
import type { traceEvents } from "./events";
import { ORIGIN_GATE_DEADLINE_MS } from "./originGate.process";
import { MAX_PROCESSED_SPANS } from "./spanDerivation";

export const EVALUATION_TRIGGER_PROCESS_NAME = "evaluationTrigger" as const;

/** Re-armed by every message; a trace evaluates once it has gone quiet for
 * this long. Deliberately shorter than the dedup TTL below (a third), so the
 * deadline cannot elapse between two deliveries of a still-ingesting trace. */
export const EVALUATION_TRIGGER_QUIET_PERIOD_MS = 30_000;
export const EVALUATION_TRIGGER_MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;
/** Outlasts the origin gate's own grace period, so a trace evaluated twice —
 * once by a late span, once by the fallback's `origin_resolved` — dispatches
 * one evaluation. */
export const EVALUATION_REQUEST_DEDUP_TTL_MS = ORIGIN_GATE_DEADLINE_MS + 60_000;

/** Stamped by nlpgo on every span an evaluator workflow emits. */
export const CAUSALITY_DEPTH_ATTRIBUTE = "langwatch.reserved.causality_depth";
const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

export const evaluationTriggerStateSchema = z.object({
  traceStartedAt: z.number().nullable(),
  lastActivityAt: z.number().nullable(),
  pendingEligibleSpanCount: z.number().int().nonnegative(),
  evaluatorEmittedSpanCount: z.number().int().nonnegative(),
  deadlineAt: z.number().nullable(),
  requestCount: z.number().int().nonnegative(),
});
export type EvaluationTriggerState = z.infer<
  typeof evaluationTriggerStateSchema
>;

export function initEvaluationTriggerState(): EvaluationTriggerState {
  return {
    traceStartedAt: null,
    lastActivityAt: null,
    pendingEligibleSpanCount: 0,
    evaluatorEmittedSpanCount: 0,
    deadlineAt: null,
    requestCount: 0,
  };
}

export const requestEvaluationsPayloadSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  occurredAt: z.number(),
  requestGeneration: z.number().int().nonnegative(),
  pendingEligibleSpanCount: z.number().int().nonnegative(),
  evaluatorEmittedSpanCount: z.number().int().nonnegative(),
});
export type RequestEvaluationsPayload = z.infer<
  typeof requestEvaluationsPayloadSchema
>;

/** The trace facts the trigger's own guards need — a narrow view of whatever
 * richer summary the composition root reads back. */
export interface TraceSummaryForEvaluation {
  readonly spanCount: number;
  readonly blockedByGuardrail: boolean;
  readonly computedOutput: string | null;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface EligibleMonitor {
  readonly id: string;
  readonly checkType: string;
  readonly name: string;
}

export interface EvaluationTriggerDispatchDeps {
  /** The causality-loop kill switch (ops override, no redeploy required). */
  isCausalityLoopGuardDisabled(tenantId: string): Promise<boolean>;
  /** Read at dispatch time, never carried on the intent (ADR-107 §16). */
  readTraceSummary(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<TraceSummaryForEvaluation | null>;
  getEnabledOnMessageMonitors(
    tenantId: string,
  ): Promise<readonly EligibleMonitor[]>;
  /** One monitor's evaluation, keyed by a derived (never minted) evaluationId
   * so a retried dispatch lands on the same evaluation rather than a second,
   * chargeable run. */
  requestEvaluation(params: {
    tenantId: string;
    traceId: string;
    occurredAt: number;
    evaluationId: string;
    monitor: EligibleMonitor;
    summary: TraceSummaryForEvaluation;
  }): Promise<void>;
}

function derivedEvaluationId(params: {
  tenantId: string;
  traceId: string;
  evaluatorId: string;
  generation: number;
}): string {
  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify({ kind: "evaluationTrigger", ...params }))
    .digest("hex");
  return `eval_md5_${hash}`;
}

/**
 * Infinite-loop prevention: nothing behind this request was real execution —
 * every span was emitted by an evaluator workflow or downstream of one — so
 * running it would evaluate our own output.
 */
async function isLoopBlocked(
  payload: RequestEvaluationsPayload,
  deps: EvaluationTriggerDispatchDeps,
): Promise<boolean> {
  if (payload.pendingEligibleSpanCount > 0) return false;
  if (payload.evaluatorEmittedSpanCount === 0) return false;
  return !(await deps.isCausalityLoopGuardDisabled(payload.tenantId));
}

function isOversizedTrace(summary: TraceSummaryForEvaluation): boolean {
  return summary.spanCount >= MAX_PROCESSED_SPANS;
}

function isEvaluableTrace(summary: TraceSummaryForEvaluation): boolean {
  if (summary.blockedByGuardrail && !summary.computedOutput) return false;
  return Boolean(summary.attributes["langwatch.origin"]);
}

/** Every monitor is attempted first, so one unreachable dispatch costs a retry
 * of the whole request rather than the other monitors' results — collapsed on
 * retry by each evaluation's own derived id. */
async function dispatchToMonitors(args: {
  deps: EvaluationTriggerDispatchDeps;
  payload: RequestEvaluationsPayload;
  summary: TraceSummaryForEvaluation;
  monitors: readonly EligibleMonitor[];
}): Promise<void> {
  const { deps, payload, summary, monitors } = args;
  const { tenantId, traceId, occurredAt } = payload;
  const failures: unknown[] = [];
  for (const monitor of monitors) {
    try {
      await deps.requestEvaluation({
        tenantId,
        traceId,
        occurredAt,
        evaluationId: derivedEvaluationId({
          tenantId,
          traceId,
          evaluatorId: monitor.id,
          generation: payload.requestGeneration,
        }),
        monitor,
        summary,
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0] instanceof Error
      ? failures[0]
      : new Error(String(failures[0]));
  }
}

export function requestEvaluationsIntents(deps: EvaluationTriggerDispatchDeps) {
  return {
    requestEvaluations: {
      payload: requestEvaluationsPayloadSchema,
      messageKey: (payload) =>
        `evaluate:${payload.traceId}:${payload.requestGeneration}`,
      async deliver(payload) {
        const { tenantId, traceId, occurredAt } = payload;
        if (await isLoopBlocked(payload, deps)) return;

        const summary = await deps.readTraceSummary({
          tenantId,
          traceId,
          occurredAtMs: occurredAt,
        });
        // Not "nothing to evaluate" — "we could not find out". Throwing hands
        // it back to the outbox rather than silently dropping the evaluation.
        if (!summary) {
          throw new Error(
            `Trace summary not found for evaluation dispatch (trace ${traceId})`,
          );
        }
        if (isOversizedTrace(summary) || !isEvaluableTrace(summary)) return;

        const monitors = await deps.getEnabledOnMessageMonitors(tenantId);
        if (monitors.length === 0) return;

        await dispatchToMonitors({ deps, payload, summary, monitors });
      },
    } satisfies IntentDef<typeof requestEvaluationsPayloadSchema>,
  };
}
type EvaluationTriggerIntents = ReturnType<typeof requestEvaluationsIntents>;

function unchanged(
  state: EvaluationTriggerState,
): EvolveStep<EvaluationTriggerState, EvaluationTriggerIntents> {
  return { state, intents: [], nextWakeAt: state.deadlineAt };
}

function observed(
  state: EvaluationTriggerState,
  view: { isEligibleSpan: boolean; isEvaluatorSpan: boolean },
  occurredAt: number,
): EvaluationTriggerState {
  return {
    ...state,
    traceStartedAt:
      state.traceStartedAt === null
        ? occurredAt
        : Math.min(state.traceStartedAt, occurredAt),
    lastActivityAt:
      state.lastActivityAt === null
        ? occurredAt
        : Math.max(state.lastActivityAt, occurredAt),
    pendingEligibleSpanCount:
      state.pendingEligibleSpanCount + (view.isEligibleSpan ? 1 : 0),
    evaluatorEmittedSpanCount:
      state.evaluatorEmittedSpanCount + (view.isEvaluatorSpan ? 1 : 0),
  };
}

function evolveOnActivity(
  state: EvaluationTriggerState,
  args: {
    isMessage: boolean;
    isEligibleSpan: boolean;
    isEvaluatorSpan: boolean;
    occurredAt: number;
  },
  ctx: ProcessContext,
): EvolveStep<EvaluationTriggerState, EvaluationTriggerIntents> {
  const seen = observed(state, args, args.occurredAt);
  if (!args.isMessage) return unchanged(seen);
  if (ctx.now - args.occurredAt > STALE_TRACE_THRESHOLD_MS)
    return unchanged(seen);
  if (
    seen.traceStartedAt !== null &&
    ctx.now - seen.traceStartedAt > EVALUATION_TRIGGER_MAX_TRACE_AGE_MS
  ) {
    return unchanged(seen);
  }
  if (!ctx.processKey) {
    return {
      state: { ...seen, deadlineAt: null },
      intents: [],
      nextWakeAt: null,
    };
  }

  const deadlineAt =
    Math.max(args.occurredAt, ctx.now) + EVALUATION_TRIGGER_QUIET_PERIOD_MS;
  return {
    state: { ...seen, deadlineAt },
    intents: [],
    nextWakeAt: deadlineAt,
  };
}

export const evaluationTriggerOn: ProcessManagerHandlerMap<
  typeof traceEvents,
  EvaluationTriggerState,
  EvaluationTriggerIntents
> = {
  spanReceived(state, data, ctx) {
    const depth = data.attributes[CAUSALITY_DEPTH_ATTRIBUTE];
    const isSynthetic = SYNTHETIC_SPAN_NAMES.has(data.name);
    const isEvaluatorSpan =
      !isSynthetic && typeof depth === "number" && depth >= 1;
    return evolveOnActivity(
      state,
      {
        isMessage: !isSynthetic,
        isEligibleSpan: !isSynthetic && !isEvaluatorSpan,
        isEvaluatorSpan,
        occurredAt: data.occurredAt,
      },
      ctx,
    );
  },
  originResolved(state, _data, ctx) {
    // Not a span itself, but what makes a deferred-origin trace evaluable —
    // restarts the quiet period the same way a message would.
    return evolveOnActivity(
      state,
      {
        isMessage: true,
        isEligibleSpan: false,
        isEvaluatorSpan: false,
        occurredAt: ctx.now,
      },
      ctx,
    );
  },
};

export function evaluationTriggerOnWake(
  state: EvaluationTriggerState,
  ctx: ProcessContext,
): EvolveStep<EvaluationTriggerState, EvaluationTriggerIntents> {
  const cleared: EvolveStep<EvaluationTriggerState, EvaluationTriggerIntents> =
    {
      state: { ...state, deadlineAt: null },
      intents: [],
      nextWakeAt: null,
    };
  if (!ctx.processKey) return cleared;

  return {
    state: {
      ...state,
      deadlineAt: null,
      pendingEligibleSpanCount: 0,
      requestCount: state.requestCount + 1,
    },
    nextWakeAt: null,
    intents: [
      {
        type: "requestEvaluations",
        payload: {
          tenantId: ctx.tenantId,
          traceId: ctx.processKey,
          occurredAt: state.lastActivityAt ?? ctx.now,
          requestGeneration: state.requestCount,
          pendingEligibleSpanCount: state.pendingEligibleSpanCount,
          evaluatorEmittedSpanCount: state.evaluatorEmittedSpanCount,
        },
      },
    ],
  };
}
