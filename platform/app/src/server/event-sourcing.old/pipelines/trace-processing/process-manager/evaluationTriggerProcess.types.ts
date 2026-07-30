import { z } from "zod";

import { ORIGIN_GATE_DEADLINE_MS } from "./originGateProcess.types";

/** Process name, as mounted on the trace pipeline. */
export const EVALUATION_TRIGGER_PROCESS_NAME = "evaluationTrigger";

export const EVALUATION_TRIGGER_INTENT_TYPES = {
  REQUEST_EVALUATIONS: "requestEvaluations",
} as const;

/**
 * The span attribute an evaluator workflow stamps on everything it emits.
 *
 * Written at OnStart by nlpgo's `BaggageAttributeProcessor` from a single
 * baggage entry on context, so every span downstream of an evaluation carries
 * it. See `specs/monitors/online-evaluator-loop-prevention.feature`.
 */
export const CAUSALITY_DEPTH_ATTRIBUTE = "langwatch.reserved.causality_depth";

/**
 * SYSTEM feature flag that bypasses the loop guard.
 *
 * An emergency rollback without a redeploy: operators flip it from the Ops UI,
 * and the legacy `LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD=1` env var still
 * works through the standard env-override path (uppercased flag key).
 */
export const CAUSALITY_LOOP_GUARD_DISABLED_FLAG =
  "ops_es_causality_loop_guard_disabled";

/**
 * How long a trace must go quiet before its monitors are asked to run.
 *
 * The same thirty seconds the dispatch already ran behind — it was a job delay
 * beside a 30-second dedup window, which collapsed a trace's spans into one
 * request — now a durable deadline on the process instance. Two things change
 * on the way across:
 *
 *  - **A restart cannot lose it.** The wait is a column, not a delayed job's
 *    schedule, which is the whole of
 *    `specs/monitors/evaluation-dispatch-durability.feature`.
 *  - **It slides.** A dedup window fires a fixed interval after the FIRST
 *    span of the window; this is re-armed by every message, so a conversation
 *    that resumes pushes its own evaluation out and is evaluated once it has
 *    actually gone quiet.
 */
export const EVALUATION_TRIGGER_QUIET_PERIOD_MS = 30_000;

/**
 * How often one trace may stage a trigger job, per decision class.
 *
 * The reactor this replaced deduplicated on `eval-trigger:{tenant}:{traceId}`
 * for thirty seconds behind a matching thirty-second delay, so a trace's spans
 * cost one job per window; the process manager that replaced it declared no
 * enqueue options at all and so cost one job — and one durable inbox row and
 * transition — per span. This is that window, restored (ADR-098).
 *
 * **Deliberately shorter than the reactor's thirty seconds**, because the wait
 * moved. The reactor had no deadline: its window WAS the wait. Here the quiet
 * period is a deadline the process re-arms on every delivery, so the window has
 * to stay strictly under it — a window as long as the quiet period could let
 * the deadline fire between two deliveries of a trace that is still ingesting,
 * evaluating a half-finished trace and then billing a second generation when
 * the rest of it lands. A third of the quiet period leaves two deliveries of
 * margin, and is pinned by a test rather than left as a coincidence.
 */
export const EVALUATION_TRIGGER_ENQUEUE_WINDOW_MS =
  EVALUATION_TRIGGER_QUIET_PERIOD_MS / 3;

/**
 * Never ask for an evaluation of a trace whose first message is older than
 * this, even on a genuine new span.
 *
 * Re-evaluating days-old traces is never wanted, and this bounds the blast
 * radius of any path that re-touches historical traces. Distinct from
 * `STALE_TRACE_THRESHOLD_MS`, which rejects a stale *event*; this bounds the
 * *trace*. The threshold matches the one the fold-bound guards apply.
 */
export const EVALUATION_TRIGGER_MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How long one evaluation request stays deduplicated on the command queue.
 *
 * Outlasts the origin grace period so a trace whose monitors are asked for
 * twice — once by a late span, once by the `origin_resolved` the gate's
 * fallback writes — runs one evaluation. Reading `ORIGIN_GATE_DEADLINE_MS`
 * directly is what keeps the two coupled: shortening the gate without moving
 * this re-opens the duplicate-evaluation window.
 */
export const EVALUATION_REQUEST_DEDUP_TTL_MS = ORIGIN_GATE_DEADLINE_MS + 60_000;

/**
 * Delivery attempts for one trace's evaluation request.
 *
 * Sized for the dispatch, not for the evaluation: the intent asks the
 * evaluation pipeline to run the monitors, and that pipeline owns its own
 * retries from there. What must not happen is the ask itself being lost — a
 * silently dropped dispatch is indistinguishable from a monitor that looked at
 * the trace and declined.
 */
export const EVALUATION_TRIGGER_MAX_ATTEMPTS = 3;

/**
 * How long a leased request stays invisible to other loops. It resolves the
 * project's monitors and reads the trace summary back before dispatching, so
 * it is a handful of reads rather than a write.
 */
export const EVALUATION_TRIGGER_LEASE_DURATION_MS = 60_000;

/**
 * What the trigger needs to remember between messages.
 *
 * Deliberately counters and instants: the trace's own content is none of the
 * process's business (ADR-098), and everything here is persisted verbatim into
 * the instance row.
 */
export interface EvaluationTriggerState {
  /**
   * The business instant of the earliest message seen on this trace — the
   * trace-age bound. The fold reads the same thing off its own `occurredAt`;
   * here it is accumulated, because a process cannot read a fold.
   */
  traceStartedAt: number | null;
  /**
   * The business instant of the most recent message. Stamped on the commands
   * the request dispatches, so an evaluation records when the trace last said
   * something rather than when a queue got round to it.
   */
  lastActivityAt: number | null;
  /**
   * Spans that could trigger an evaluation — real execution at causality
   * depth zero — **that no request has carried yet**.
   *
   * Reset by the wake that raises a request, so it counts the spans the NEXT
   * request would be asking about rather than everything the trace ever saw.
   * That is what makes the loop guard per-span again: once a trace's real
   * spans have been asked about, an evaluator's own span cannot re-arm a
   * dispatch on the strength of them. A cumulative count let it, because a
   * trace that ever had one real span read as "not a loop" forever
   * (`specs/monitors/online-evaluator-loop-prevention.feature`).
   */
  pendingEligibleSpanCount: number;
  /**
   * Spans an evaluator emitted, over the instance's whole life.
   *
   * Cumulative on purpose, unlike the pending count above. It is only ever
   * read to tell a loop from a trace that simply has nothing to evaluate, and
   * a trace whose every span came out of an evaluator must stay blocked when
   * its origin resolves minutes later — by which time a per-request count
   * would have been reset to zero.
   */
  evaluatorEmittedSpanCount: number;
  /**
   * The armed quiet-period deadline, or null. Held in state because
   * `nextWakeAt` is authoritative on every commit — a handler that returns
   * nothing CLEARS the wake, so each one has to re-state the deadline it is
   * leaving alone.
   */
  deadlineAt: number | null;
  /**
   * How many evaluation requests this trace has already asked for.
   *
   * It is the request key's generation, and the reason there is no "requested"
   * latch. A latch would be the stronger guarantee for a trace that settles
   * once, but it makes a declined request permanent: a request that arrives
   * before the origin gate has resolved the trace's origin correctly asks for
   * nothing, and the `origin_resolved` that follows has to be able to ask
   * again. Repeats collapse on the command queue's own dedup key, which is
   * where "do not evaluate a trace twice with the same monitor" is enforced.
   */
  requestCount: number;
}

export const INITIAL_EVALUATION_TRIGGER_STATE: EvaluationTriggerState = {
  traceStartedAt: null,
  lastActivityAt: null,
  pendingEligibleSpanCount: 0,
  evaluatorEmittedSpanCount: 0,
  deadlineAt: null,
  requestCount: 0,
};

/**
 * The content boundary. Trace events carry whole spans — prompts, completions,
 * tool output — and the default payload would persist every one of them into
 * the instance row and the outbox. The trigger only ever asks two yes/no
 * questions of a message, so those are the only two things that cross.
 */
export const evaluationTriggerEventViewSchema = z.object({
  /**
   * Genuine new message content, which restarts the trace's quiet period.
   *
   * False for a synthetic event span: feedback posted through
   * `/api/track_event` does not contribute to the trace's derived IO and must
   * not re-run on-message monitors. True for an evaluator's own span, which
   * decides nothing but is still activity on the trace — the same thing its
   * predecessor did by rejecting it inside the handler rather than before the
   * queue.
   */
  isMessage: z.boolean(),
  /**
   * A span that could trigger an evaluation on its own: real execution, at
   * causality depth zero.
   */
  isEligibleSpan: z.boolean(),
  /**
   * A span an evaluator workflow emitted, or something downstream of one.
   * Evaluating it would evaluate our own output.
   */
  isEvaluatorSpan: z.boolean(),
});

export type EvaluationTriggerEventView = z.infer<
  typeof evaluationTriggerEventViewSchema
>;

/**
 * Ask the project's on-message monitors to evaluate this trace.
 *
 * Identities and counters only. Everything the commands actually carry —
 * thread, labels, computed input and output — is read back from the committed
 * trace summary at dispatch time, so none of it is persisted here.
 *
 * `traceId` is non-empty by construction: a request addressed at nothing
 * cannot read a trace summary, and the wake refuses to raise one. This rejects
 * it loudly if that guard is ever removed.
 */
export const evaluationTriggerRequestIntentSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  /** The trace's last business instant; stamped on each command. */
  occurredAt: z.number(),
  /**
   * Which ask this is for the trace. @see EvaluationTriggerState.requestCount
   *
   * On the payload rather than only in the message key because the evaluation
   * ids are derived from it: every attempt at one generation asks for the same
   * evaluations, so a retry cannot bill a second run of one it already
   * dispatched, while a later generation is a genuine re-run and gets its own.
   */
  requestGeneration: z.number().int().nonnegative(),
  /** @see EvaluationTriggerState.pendingEligibleSpanCount */
  pendingEligibleSpanCount: z.number().int().nonnegative(),
  /** @see EvaluationTriggerState.evaluatorEmittedSpanCount */
  evaluatorEmittedSpanCount: z.number().int().nonnegative(),
});

export type EvaluationTriggerRequestIntent = z.infer<
  typeof evaluationTriggerRequestIntentSchema
>;

/**
 * The outbox message key for one evaluation request.
 *
 * Derived, never minted (ADR-098): the outbox skips a duplicate key on insert,
 * so a wake that fires twice for the same generation asks once. The generation
 * is what lets a trace that resumes — or that only became evaluable when its
 * origin resolved — ask again.
 */
export function requestEvaluationsMessageKey(
  traceId: string,
  generation: number,
): string {
  return `evaluate:${traceId}:${generation}`;
}
