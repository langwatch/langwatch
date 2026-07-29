import type {
  EventHandler,
  IntentSpec,
  ProcessEvolution,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  ORIGIN_GATE_DEADLINE_MS,
  type OriginGateEventView,
  type OriginGateState,
  originGateEventViewSchema,
  type originGateResolveIntentSchema,
} from "./originGateProcess.types";

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
 * Reads one string attribute out of a raw OTLP `KeyValue[]`.
 *
 * Total by construction: unknown shapes read as absent. It deliberately does
 * NOT go through `normalizeOtlpAttributeMap` — that flattens, reconstructs
 * arrays and JSON-parses the WHOLE attribute set, which on a span means
 * parsing the prompts and completions this boundary exists to keep out. Six
 * single-key lookups are what the gate needs.
 */
function readOtlpString(attributes: unknown, key: string): string | null {
  if (!Array.isArray(attributes)) return null;
  for (const attribute of attributes) {
    if (typeof attribute !== "object" || attribute === null) continue;
    const entry = attribute as { key?: unknown; value?: unknown };
    if (entry.key !== key) continue;
    const value = entry.value as { stringValue?: unknown } | null | undefined;
    const text = value?.stringValue;
    return typeof text === "string" && text.length > 0 ? text : null;
  }
  return null;
}

/** Whether the key is present at all, whatever type it carries. */
function hasOtlpKey(attributes: unknown, key: string): boolean {
  if (!Array.isArray(attributes)) return false;
  return attributes.some(
    (attribute) =>
      typeof attribute === "object" &&
      attribute !== null &&
      (attribute as { key?: unknown }).key === key,
  );
}

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
  const span = data.span as { attributes?: unknown } | null | undefined;
  const resource = data.resource as { attributes?: unknown } | null | undefined;
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
  const span = data.span as { parentSpanId?: unknown } | null | undefined;
  const resource = data.resource as { attributes?: unknown } | null | undefined;

  return {
    originDecided: spanEvidence(data),
    // A root span is one with no parent. Matches the fold, which reads a
    // falsy wire `parentSpanId` as "no parent" before normalizing it.
    isRootSpan: span != null && !span.parentSpanId,
    sdkPresent:
      readOtlpString(resource?.attributes, "telemetry.sdk.name") !== null,
  };
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
