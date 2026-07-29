import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  createOriginGateResolveHandler,
  type OriginGateDispatchDeps,
} from "./originGateIntentHandlers";
import {
  INITIAL_ORIGIN_GATE_STATE,
  ORIGIN_GATE_DEADLINE_MS,
  ORIGIN_GATE_ENQUEUE_WINDOW_MS,
  ORIGIN_GATE_INTENT_TYPES,
  ORIGIN_GATE_LEASE_DURATION_MS,
  ORIGIN_GATE_MAX_ATTEMPTS,
  type OriginGateEventView,
  type OriginGateState,
  originGateEventViewSchema,
  originGateResolveIntentSchema,
} from "./originGateProcess.types";
import {
  hasOtlpKey,
  readOtlpString,
  resourceOf,
  spanOf,
} from "./otlpEventView";

/**
 * The `originGate` process (ADR-075 Class E): pure state logic only. The
 * pipeline mounts these handlers; the runtime owns the manager, outbox and
 * wake workers.
 *
 * Its single job is to guarantee every trace ends up with an origin. Traces
 * that say what they are — an SDK, a platform surface, an evaluation run —
 * resolve at fold time and the gate never fires. A pure-OTEL trace says
 * nothing, so after a grace period the gate writes `application` on its
 * behalf.
 *
 * The grace period is the whole reason this is a process manager rather than
 * a subscriber. It used to be a five-minute queue delay: a job with the timer
 * living wherever the queue happened to keep it, which is to say a process
 * manager written by hand. Here it is a `nextWakeAt` on a durable row, so the
 * fallback survives the worker that armed it.
 *
 * Two things get strictly better on the way across:
 *
 *  - **The deadline is cancelled, not just ignored.** The old job fired
 *    regardless and leaned on the fold's no-override guard to make a
 *    redundant `origin_resolved` harmless. A trace that resolves during the
 *    grace period now clears its own wake and no event is ever written.
 *  - **A restart cannot lose it.** The deadline is a column, not a delayed
 *    job's schedule.
 */

export type OriginGateIntents = {
  resolveOrigin: IntentSpec<typeof originGateResolveIntentSchema>;
};

type Ctx = ProcessHandlerContext<OriginGateIntents>;

/**
 * Instrumentation scopes that identify the emitter well enough for the fold
 * to resolve an origin from them alone. Mirrors the first two
 * `LEGACY_ORIGIN_RULES` in
 * `projections/services/trace-origin.service.ts` — the source of truth for
 * what counts as a legacy marker.
 */
const ORIGIN_BEARING_SCOPES: ReadonlySet<string> = new Set([
  "langwatch-evaluation",
  "@langwatch/scenario",
]);

/**
 * Evidence that the fold has resolved — or is resolving — an origin for this
 * trace, read off the wire span.
 *
 * Two of the fold's weaker signals are deliberately left out: a
 * `scenario-runner` entry inside the `langwatch.labels` array, and a
 * `metadata.platform` that arrived kvlist-encoded rather than as a flat key.
 * Both would need the full attribute normalization this boundary avoids, and
 * both name traces the earlier checks already catch by scope or resource. If
 * one ever slips through, the cost is a fallback command the fold discards.
 */
function spanEvidence(data: Record<string, unknown>): boolean {
  const span = spanOf(data);
  const resource = resourceOf(data);
  const scope = data.instrumentationScope as
    | { name?: unknown }
    | null
    | undefined;

  // Explicit, on the span or (for provenance-stamped ingest) the resource.
  if (readOtlpString(span?.attributes, "langwatch.origin")) return true;
  if (readOtlpString(resource?.attributes, "langwatch.origin")) return true;

  if (
    typeof scope?.name === "string" &&
    ORIGIN_BEARING_SCOPES.has(scope.name)
  ) {
    return true;
  }

  if (
    readOtlpString(span?.attributes, "metadata.platform") ===
    "optimization_studio"
  ) {
    return true;
  }

  if (hasOtlpKey(span?.attributes, "evaluation.run_id")) return true;
  if (hasOtlpKey(resource?.attributes, "scenario.labels")) return true;

  return false;
}

/**
 * The content boundary (`toPayload`): narrows a committed trace event to the
 * three flags the gate reasons about. Everything else — spans, prompts,
 * completions, log bodies — stops here.
 *
 * Total: it runs against untrusted wire data behind a cast, so every read is
 * shape-checked rather than trusted.
 */
export function buildProcessEventView(
  event: TraceProcessingEvent,
): OriginGateEventView {
  if (event.type === ORIGIN_RESOLVED_EVENT_TYPE) {
    return { originDecided: true, isRootSpan: false, sdkPresent: false };
  }

  const data = (event.data ?? {}) as Record<string, unknown>;
  const span = spanOf(data);
  const resource = resourceOf(data);

  return {
    originDecided: spanEvidence(data),
    // A root span is one with no parent. Matches the fold, which reads a
    // falsy wire `parentSpanId` as "no parent" before normalizing it.
    isRootSpan: span !== null && !span.parentSpanId,
    sdkPresent:
      readOtlpString(resource?.attributes, "telemetry.sdk.name") !== null,
  };
}

/**
 * The enqueue-time collapse key: one trace, one decision class.
 *
 * A dedup window makes the process SEE FEWER EVENTS, so the key has to keep
 * apart anything that would drive a different transition. The gate's own
 * narrowing is exactly that partition — two events with the same
 * `{originDecided, isRootSpan, sdkPresent}` are interchangeable to it — so an
 * evidence-bearing span can never be collapsed into a plain one, an
 * `origin_resolved` can never be collapsed into a span that would leave the
 * gate open, and the root span that closes an SDK trace keeps its own key.
 *
 * Total, because `buildProcessEventView` is: it runs at the routing seam, where
 * a throw permanently loses this process's job for the event (ADR-069).
 */
export function originGateEnqueueDedupId(event: TraceProcessingEvent): string {
  const view = buildProcessEventView(event);
  const decisionClass = `${view.originDecided ? "d" : "-"}${
    view.isRootSpan ? "r" : "-"
  }${view.sdkPresent ? "s" : "-"}`;
  return `origin-gate:${String(event.tenantId)}:${String(
    event.aggregateId,
  )}:${decisionClass}`;
}

/**
 * Schedule from the present, never from business time alone. A backed-up
 * subscriber can deliver a span whose grace period has already elapsed;
 * scheduling from it would write a deadline in the past and fire the fallback
 * immediately, against a trace whose real spans are still arriving.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

/**
 * A resync or backfill flood, not a live trace. The reactor skipped these
 * outright; here the test is the gap between when the event happened and when
 * it is being handled, which is the same question asked of data the process
 * already has.
 */
function isStale(ctx: Ctx): boolean {
  return ctx.now - ctx.at > STALE_TRACE_THRESHOLD_MS;
}

/** Close the gate for good: no deadline, and nothing can re-arm one. */
function closed(state: OriginGateState): ProcessEvolution<OriginGateState> {
  return {
    state: { ...state, resolved: true, deadlineAt: null },
    nextWakeAt: null,
  };
}

/** Leave the armed deadline exactly where it is. */
function unchanged(state: OriginGateState): ProcessEvolution<OriginGateState> {
  return { state, nextWakeAt: state.deadlineAt };
}

function evolveGate(
  state: OriginGateState,
  payload: unknown,
  ctx: Ctx,
): ProcessEvolution<OriginGateState> {
  const view = originGateEventViewSchema.parse(payload);
  const seen: OriginGateState = {
    ...state,
    sdkSeen: state.sdkSeen || view.sdkPresent,
  };

  // Once a trace has an origin it keeps it — the fold never unsets one — so a
  // straggling span must not re-arm a gate that has already closed.
  if (seen.resolved) return closed(seen);

  if (view.originDecided || (view.isRootSpan && seen.sdkSeen)) {
    return closed(seen);
  }

  if (isStale(ctx)) return unchanged(seen);

  // A trace aggregate with an empty id cannot be resolved, and a fallback
  // addressed at nothing produces an `origin_resolved` with an empty
  // aggregateId that the automations pipeline rejects later. Never arm one.
  if (!ctx.key)
    return { state: { ...seen, deadlineAt: null }, nextWakeAt: null };

  // Armed once, from the first span that found no origin — a long trace's
  // later spans must not keep pushing the fallback out. This is what the old
  // job's `extend: false` dedup bought, stated rather than configured.
  if (seen.deadlineAt !== null) return unchanged(seen);

  const deadlineAt = schedulingRef(ctx) + ORIGIN_GATE_DEADLINE_MS;
  return { state: { ...seen, deadlineAt }, nextWakeAt: deadlineAt };
}

/**
 * A span (or a log record contributing to a trace) arrived. Either it says
 * what the trace is — and the gate closes — or the trace is now on the clock.
 *
 * Log contributions carry no origin evidence of their own: the fold resolves
 * origin from spans only, so a log-only trace is exactly the case the
 * fallback exists for.
 */
export const handleTraceActivity: EventHandler<
  OriginGateState,
  unknown,
  OriginGateIntents
> = (state, payload, ctx) => evolveGate(state, payload, ctx);

/**
 * An origin was written — by the gate's own fallback, or by anything else
 * that resolves one. Close the gate and clear the deadline.
 */
export const handleOriginResolved: EventHandler<
  OriginGateState,
  unknown,
  OriginGateIntents
> = (state) => closed(state);

/**
 * The grace period elapsed with no origin in sight. Write the fallback.
 *
 * `resolved` is latched here rather than waiting for the resulting
 * `origin_resolved` to fold back, so a second wake arriving while the intent
 * is still in the outbox cannot emit a second one.
 */
export const originGateWake: WakeHandler<OriginGateState, OriginGateIntents> = (
  state,
  ctx,
) => {
  if (state.resolved) return closed(state);

  // Nothing to address the fallback at. Clearing rather than retrying stops
  // the wake worker re-finding this instance forever.
  if (!ctx.key || !ctx.projectId) return closed(state);

  return {
    state: { ...state, resolved: true, deadlineAt: null },
    nextWakeAt: null,
    intents: [
      ctx.intents.resolveOrigin(`resolve-origin:${ctx.key}`, {
        tenantId: ctx.projectId,
        traceId: ctx.key,
      }),
    ],
  };
};

/**
 * The `originGate` process-manager topology, exported standalone so the
 * pipeline mounts one expression of it and tests can build the exact
 * definition the runtime runs. `trace-processing/pipeline.ts` mounts it as
 * `.withProcessManager(ORIGIN_GATE_PROCESS_NAME, originGatePM({ resolveOrigin:
 * deps.commands.port(ResolveOriginCommand) }))`, so the grace period is a
 * durable deadline on the process instance rather than a delayed job — and the
 * fallback write is a self-dispatch through the command bus, with no `Deferred`
 * between the two.
 *
 * The declared event set is narrower than the reactor's, which fired on every
 * event the traceSummary fold handled. Spans and log contributions are the
 * only things that can leave a trace without an origin, and `origin_resolved`
 * is the only thing that settles it; a topic assignment, an annotation or a
 * rename arrives on a trace that already exists and decides nothing about
 * where it came from. Every event type declared here costs a durable
 * transition per trace, so the set is the question the process actually asks.
 */
export function originGatePM(
  dispatch: OriginGateDispatchDeps,
): ProcessManagerApplier<TraceProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_ORIGIN_GATE_STATE)
      .intent(
        ORIGIN_GATE_INTENT_TYPES.RESOLVE_ORIGIN,
        originGateResolveIntentSchema,
        createOriginGateResolveHandler(dispatch),
      )
      .on(SPAN_RECEIVED_EVENT_TYPE, handleTraceActivity)
      .on(LOG_RECORD_RECEIVED_EVENT_TYPE, handleTraceActivity)
      .on(LOG_CONTRIBUTED_EVENT_TYPE, handleTraceActivity)
      .on(ORIGIN_RESOLVED_EVENT_TYPE, handleOriginResolved)
      .onWake(originGateWake)
      .toPayload(buildProcessEventView)
      // One job per trace per window per decision class, instead of one per
      // span. `shouldSurviveDispatch` is what makes the TTL a real rate bound:
      // without it a dedup key whose job has already dispatched is treated as
      // stale, so on a trace that keeps up with its own ingest every span
      // stages again and the window buys nothing. `extend: false` pins the
      // window to its first event, so a continuously-ingesting trace cannot
      // debounce its own gate indefinitely.
      .enqueue({
        deduplication: {
          makeId: originGateEnqueueDedupId,
          ttlMs: ORIGIN_GATE_ENQUEUE_WINDOW_MS,
          extend: false,
          shouldSurviveDispatch: true,
        },
      })
      .outbox({
        maxAttempts: ORIGIN_GATE_MAX_ATTEMPTS,
        leaseDurationMs: ORIGIN_GATE_LEASE_DURATION_MS,
      });
}
