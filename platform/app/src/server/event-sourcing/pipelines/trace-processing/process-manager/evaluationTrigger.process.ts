import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  ProcessManagerEnqueueOptions,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { SYNTHETIC_SPAN_NAMES } from "~/server/tracer/constants";

import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  createEvaluationTriggerRequestHandler,
  type EvaluationTriggerDispatchDeps,
} from "./evaluationTriggerIntentHandlers";
import {
  CAUSALITY_DEPTH_ATTRIBUTE,
  EVALUATION_TRIGGER_ENQUEUE_WINDOW_MS,
  EVALUATION_TRIGGER_INTENT_TYPES,
  EVALUATION_TRIGGER_LEASE_DURATION_MS,
  EVALUATION_TRIGGER_MAX_ATTEMPTS,
  EVALUATION_TRIGGER_MAX_TRACE_AGE_MS,
  EVALUATION_TRIGGER_QUIET_PERIOD_MS,
  type EvaluationTriggerEventView,
  type EvaluationTriggerState,
  evaluationTriggerEventViewSchema,
  evaluationTriggerRequestIntentSchema,
  INITIAL_EVALUATION_TRIGGER_STATE,
  requestEvaluationsMessageKey,
} from "./evaluationTriggerProcess.types";
import { readOtlpNumber, spanOf } from "./otlpEventView";

/**
 * The `evaluationTrigger` process (ADR-075 Class D): pure state logic only. The
 * pipeline mounts these handlers; the runtime owns the manager, outbox and
 * wake workers.
 *
 * Its job is to make sure a monitor someone configured actually runs on the
 * traces it matches. Online evaluation execution was already durable — the
 * command it dispatches rides a queue that retries — but the dispatch itself
 * was not: lose it and no command is ever enqueued, nothing retries, and no
 * error is raised anywhere. The trace simply has no evaluation, which looks
 * exactly like a monitor that legitimately declined
 * (`specs/monitors/evaluation-dispatch-durability.feature`).
 *
 * Two things become durable here:
 *
 *  - **The ask is a leased outbox message**, committed in the same transaction
 *    as the inbox row. A worker that dies between consuming the event and
 *    dispatching no longer loses the evaluation.
 *  - **The wait is a deadline.** It used to be a job delay beside a dedup
 *    window; now it is `nextWakeAt` on a durable row, re-armed by every
 *    message, so a conversation that resumes pushes its own evaluation out and
 *    is evaluated once it has gone quiet.
 *
 * **Every guard that can fail stays out of these handlers.** The predicate
 * these replace failed OPEN — a throw was caught, logged and read as "yes",
 * so a side effect was never dropped — and its pre-enqueue successor fails
 * LOST, because the routing seam has no retry (ADR-075, "The one migration
 * hazard"). Nothing data-dependent or fallible is expressed at delivery time
 * here: the monitor matching, the trace read-back, the origin and guardrail
 * checks and the loop guard's feature flag all live in the intent handler,
 * where a failure retries that message instead of dropping the evaluation. The
 * only things decided here are total questions about the event itself, and
 * every one of them degrades towards dispatching.
 */

export type EvaluationTriggerIntents = {
  requestEvaluations: IntentSpec<typeof evaluationTriggerRequestIntentSchema>;
};

type Ctx = ProcessHandlerContext<EvaluationTriggerIntents>;

/**
 * The content boundary (`toPayload`): narrows a committed trace event to the
 * three flags the trigger reasons about. Everything else — spans, prompts,
 * completions, log bodies — stops here, and is read back from the committed
 * trace summary at dispatch time instead.
 *
 * Total, and total in the FAIL-OPEN direction: it runs against untrusted wire
 * data behind a cast, so every read is shape-checked, and a span it cannot
 * make sense of reads as an ordinary message rather than as one to skip. A
 * misread costs a request the intent handler then declines; the opposite
 * misread costs a customer their evaluation, silently.
 */
export function buildProcessEventView(
  event: TraceProcessingEvent,
): EvaluationTriggerEventView {
  // The origin gate resolved this trace. It is not a span, so it triggers
  // nothing on its own — but it is what makes a deferred-origin trace
  // evaluable, so it restarts the quiet period.
  if (event.type === ORIGIN_RESOLVED_EVENT_TYPE) {
    return { isMessage: true, isEligibleSpan: false, isEvaluatorSpan: false };
  }

  // Anything else is a derived enrichment — a topic assignment, an
  // annotation, a rename — which updates the trace but adds no message
  // content, and must not re-run the project's monitors. A daily
  // topic-clustering pass re-touches thousands of historical traces, and
  // treating that as new activity re-ran every monitor over the whole backlog
  // (2026-05-27 read-amplification incident). The process is mounted on spans
  // and `origin_resolved` alone, and stating it here means mounting one more
  // event type cannot quietly reopen that.
  if (event.type !== SPAN_RECEIVED_EVENT_TYPE) {
    return { isMessage: false, isEligibleSpan: false, isEvaluatorSpan: false };
  }

  const data = (event.data ?? {}) as Record<string, unknown>;
  const span = spanOf(data);
  const name = span?.name;

  // Synthetic feedback spans (thumbs-up/down via `/api/track_event`) do not
  // contribute to the fold's derived IO and must not re-run on-message
  // monitors. A span whose name cannot be read is treated as real.
  const isSynthetic =
    typeof name === "string" && SYNTHETIC_SPAN_NAMES.has(name);

  // Depth-only per-span check: a span at depth >= 1 was emitted by an
  // evaluator workflow, or downstream of one. Origin stays a user-configurable
  // precondition rather than a hardcoded rule, so it is not consulted here.
  const depth = readOtlpNumber(span?.attributes, CAUSALITY_DEPTH_ATTRIBUTE);
  const isEvaluatorSpan = depth !== null && depth >= 1;

  return {
    isMessage: !isSynthetic,
    isEligibleSpan: !isSynthetic && !isEvaluatorSpan,
    isEvaluatorSpan: !isSynthetic && isEvaluatorSpan,
  };
}

/**
 * The enqueue-time collapse key: one trace, one decision class.
 *
 * A dedup window makes the process SEE FEWER EVENTS, so the key has to keep
 * apart anything that would drive a different transition — and here that is not
 * a nicety. The loop guard asks whether any span this request is about was real
 * execution; collapsing an eligible span into an evaluator's own span would
 * answer "loop" for a trace that had genuine activity and silently decline a
 * customer's evaluation. Keyed on the trigger's own narrowing, the two can
 * never collide: an eligible span, an evaluator span, a synthetic span and an
 * `origin_resolved` each hold their own key.
 *
 * What the window DOES cost is exactness of the counts:
 * `pendingEligibleSpanCount` becomes the number of windows in which an eligible
 * span landed rather than the number of spans. Both readers of it ask only
 * whether it is above zero, which the key preserves.
 *
 * Total, because `buildProcessEventView` is: it runs at the routing seam, where
 * a throw permanently loses this process's job for the event (ADR-069).
 */
export function evaluationTriggerEnqueueDedupId(
  event: TraceProcessingEvent,
): string {
  const view = buildProcessEventView(event);
  const decisionClass = `${view.isMessage ? "m" : "-"}${
    view.isEligibleSpan ? "e" : "-"
  }${view.isEvaluatorSpan ? "v" : "-"}`;
  return `eval-trigger:${String(event.tenantId)}:${String(
    event.aggregateId,
  )}:${decisionClass}`;
}

/**
 * The enqueue-time gate, declared here rather than at the mount because what a
 * process may decline before a job exists is a property of the process.
 *
 * No `filter`: every event this process is mounted on moves its state. A span
 * it will not act on still bounds the trace's age, still counts towards the
 * loop guard, and still re-arms the quiet period, so there is nothing here that
 * can be declined pre-enqueue without deciding something the handler is
 * supposed to decide.
 *
 * `shouldSurviveDispatch` is what makes the TTL a real rate bound: without it a
 * dedup key whose job already dispatched is treated as stale, so on a trace
 * that keeps up with its own ingest every span stages again and the window buys
 * nothing. `extend: false` pins the window to its first event, so a
 * continuously-ingesting trace cannot debounce its own delivery indefinitely —
 * which is exactly what would let the quiet period elapse unnoticed.
 */
export const EVALUATION_TRIGGER_ENQUEUE: ProcessManagerEnqueueOptions<TraceProcessingEvent> =
  {
    deduplication: {
      makeId: evaluationTriggerEnqueueDedupId,
      ttlMs: EVALUATION_TRIGGER_ENQUEUE_WINDOW_MS,
      extend: false,
      shouldSurviveDispatch: true,
    },
  };

/**
 * Schedule from the present, never from business time alone. A backed-up
 * subscriber can deliver a span whose quiet period has already elapsed;
 * scheduling from it would write a deadline in the past and evaluate a trace
 * whose messages are still arriving.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

/**
 * A resync or backfill flood, not a live trace. Replay and resync paths
 * re-emit events with historical `occurredAt`, and re-evaluating them is never
 * wanted; the test is the gap between when the event happened and when it is
 * being handled.
 */
function isStale(ctx: Ctx): boolean {
  return ctx.now - ctx.at > STALE_TRACE_THRESHOLD_MS;
}

/**
 * A trace whose first message is older than the cutoff. Checks the TRACE's own
 * start rather than the event's instant — a re-emitted or late event is fresh,
 * but the trace it lands on may be days old.
 */
function isHistoricTrace(state: EvaluationTriggerState, ctx: Ctx): boolean {
  return (
    state.traceStartedAt !== null &&
    ctx.now - state.traceStartedAt > EVALUATION_TRIGGER_MAX_TRACE_AGE_MS
  );
}

/** Leave the armed deadline exactly where it is. */
function unchanged(
  state: EvaluationTriggerState,
): ProcessEvolution<EvaluationTriggerState> {
  return { state, nextWakeAt: state.deadlineAt };
}

/**
 * Fold this message's identities and counters into state, whether or not it
 * goes on to arm anything. Counting a message the trigger then declines to act
 * on is what lets the intent handler tell "nothing to evaluate" from "every
 * span here came out of an evaluation".
 */
function observed(
  state: EvaluationTriggerState,
  view: EvaluationTriggerEventView,
  ctx: Ctx,
): EvaluationTriggerState {
  return {
    ...state,
    traceStartedAt:
      state.traceStartedAt === null
        ? ctx.at
        : Math.min(state.traceStartedAt, ctx.at),
    lastActivityAt:
      state.lastActivityAt === null
        ? ctx.at
        : Math.max(state.lastActivityAt, ctx.at),
    pendingEligibleSpanCount:
      state.pendingEligibleSpanCount + (view.isEligibleSpan ? 1 : 0),
    evaluatorEmittedSpanCount:
      state.evaluatorEmittedSpanCount + (view.isEvaluatorSpan ? 1 : 0),
  };
}

/**
 * A message arrived on this trace — a span, or the origin the gate resolved
 * for it. Push the trace's evaluation out to a full quiet period from now.
 */
export const handleTraceActivity: EventHandler<
  EvaluationTriggerState,
  unknown,
  EvaluationTriggerIntents
> = (state, payload, ctx) => {
  const view = evaluationTriggerEventViewSchema.parse(payload);
  const seen = observed(state, view, ctx);

  // A synthetic event span is not new message content. It is still counted
  // above, so the trace's start and last-activity instants stay honest.
  if (!view.isMessage) return unchanged(seen);

  if (isStale(ctx)) return unchanged(seen);
  if (isHistoricTrace(seen, ctx)) return unchanged(seen);

  // A trace aggregate with an empty id cannot be evaluated: the request reads
  // the trace summary back by id. Never arm one.
  if (!ctx.key) {
    return { state: { ...seen, deadlineAt: null }, nextWakeAt: null };
  }

  const deadlineAt = schedulingRef(ctx) + EVALUATION_TRIGGER_QUIET_PERIOD_MS;
  return { state: { ...seen, deadlineAt }, nextWakeAt: deadlineAt };
};

/**
 * The trace has been quiet for a full period. Ask for its evaluations.
 *
 * The request is raised unconditionally for a trace that armed one, including
 * a trace whose every span came out of an evaluator. That is deliberate: the
 * loop guard consults a feature flag and records a metric, both of which are
 * side effects that belong in the intent handler, and declining here would
 * decide it with the flag unread. An ask the handler declines costs one outbox
 * row; an ask never raised costs a customer their evaluation.
 *
 * The generation is bumped here rather than after the dispatch lands, so a
 * second wake arriving while the intent is still in the outbox collapses onto
 * the same message key instead of asking twice.
 *
 * The pending eligible-span count is HANDED OVER: the raised request carries
 * it and the instance goes back to zero. Every real span is therefore asked
 * about exactly once, and the next request has to be justified by spans that
 * arrive after this one — which is what stops an evaluator's own span riding
 * on the trace's history into a fresh dispatch. The count travels on the
 * payload, so a retry of this request asks about the same spans rather than
 * about none.
 */
export const evaluationTriggerWake: WakeHandler<
  EvaluationTriggerState,
  EvaluationTriggerIntents
> = (state, ctx) => {
  const cleared = { state: { ...state, deadlineAt: null }, nextWakeAt: null };

  // Nothing to address the request at. Clearing rather than retrying stops the
  // wake worker re-finding this instance forever. The pending count is left
  // alone: no request carried it away.
  if (!ctx.key || !ctx.projectId) return cleared;

  return {
    state: {
      ...state,
      deadlineAt: null,
      pendingEligibleSpanCount: 0,
      requestCount: state.requestCount + 1,
    },
    nextWakeAt: null,
    intents: [
      ctx.intents.requestEvaluations(
        requestEvaluationsMessageKey(ctx.key, state.requestCount),
        {
          tenantId: ctx.projectId,
          traceId: ctx.key,
          occurredAt: state.lastActivityAt ?? ctx.now,
          requestGeneration: state.requestCount,
          pendingEligibleSpanCount: state.pendingEligibleSpanCount,
          evaluatorEmittedSpanCount: state.evaluatorEmittedSpanCount,
        },
      ),
    ],
  };
};

/**
 * The `evaluationTrigger` process-manager topology, exported standalone so the
 * pipeline mounts one expression of it and tests can build the exact definition
 * the runtime runs. `trace-processing/pipeline.ts` mounts it as
 * `.withProcessManager(EVALUATION_TRIGGER_PROCESS_NAME,
 * evaluationTriggerPM(deps.evaluationTriggerDispatch))`.
 *
 * The project's on-message monitors run once the trace has gone quiet for a
 * full period. The quiet period is re-armed by every message, so a conversation
 * that resumes pushes its own evaluation out; every fallible guard lives in the
 * intent handler, where a failure retries the ask instead of dropping it
 * (ADR-075 Class D).
 */
export function evaluationTriggerPM(
  dispatch: EvaluationTriggerDispatchDeps,
): ProcessManagerApplier<TraceProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_EVALUATION_TRIGGER_STATE)
      .intent(
        EVALUATION_TRIGGER_INTENT_TYPES.REQUEST_EVALUATIONS,
        evaluationTriggerRequestIntentSchema,
        createEvaluationTriggerRequestHandler(dispatch),
      )
      .on(SPAN_RECEIVED_EVENT_TYPE, handleTraceActivity)
      .on(ORIGIN_RESOLVED_EVENT_TYPE, handleTraceActivity)
      .onWake(evaluationTriggerWake)
      .toPayload(buildProcessEventView)
      .enqueue(EVALUATION_TRIGGER_ENQUEUE)
      .outbox({
        maxAttempts: EVALUATION_TRIGGER_MAX_ATTEMPTS,
        leaseDurationMs: EVALUATION_TRIGGER_LEASE_DURATION_MS,
      });
}
