import { createLogger } from "@langwatch/observability";
import type { TriggerContext } from "../../../pipeline/processManagerDefinition";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { ResolveOriginCommandData } from "../schemas/commands";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import {
  isSpanReceivedEvent,
  type TraceProcessingEvent,
} from "../schemas/events";

const logger = createLogger("langwatch:trace-processing:origin-gate");

/** Delay (ms) before the deferred origin resolution fires */
export const DEFERRED_CHECK_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export const ORIGIN_GATE_DELAY_MS = 5_000; // settle before checking origin
export const ORIGIN_GATE_DEDUP_TTL_MS = 15_000; // debounce multi-span trace bursts

export type DeferredOriginPayload = {
  id: string; // traceId — used as staged job ID for debuggability
  tenantId: string;
  traceId: string;
};

export interface OriginGateSubscriberDeps {
  scheduleDeferred: (payload: DeferredOriginPayload) => Promise<void>;
}

/**
 * Pure relevance guard, shared by `when` (pre-enqueue, sees the committed
 * fold state) and the handler (fail-open path): skip stale resync traces and
 * traces whose origin is already resolved.
 *
 * Only a span arrival can open the deferred path. Enrichment events such as
 * topic_assigned are re-emitted for a whole backlog by a scheduled clustering
 * pass, stamped with the current time, so the stale check above does not
 * catch them. A trace older than the fold's read window folds such an event
 * from an empty state, and the missing origin is an artefact of that empty
 * state, not an unresolved trace. Resolving it anyway labelled a whole
 * backlog of old traces "application" and dispatched monitors on each.
 */
export function needsOriginResolution({
  event,
  foldState,
}: {
  event: TraceProcessingEvent;
  foldState: TraceSummaryData;
}): boolean {
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return !foldState.attributes?.["langwatch.origin"];
}

/**
 * Ensures every trace gets an origin resolved.
 *
 * Fires on span arrivals (via traceSummary fold). If origin is already
 * set (explicit, legacy markers, or SDK heuristic), this is a no-op.
 * If absent (pure OTEL traces), schedules a 5-minute deferred origin
 * resolution job.
 *
 * Completely decoupled from evaluation dispatch — evaluationTrigger
 * handles that independently.
 */
export function createOriginGateHandler(
  deps: OriginGateSubscriberDeps,
): (
  event: TraceProcessingEvent,
  context: TriggerContext<TraceSummaryData>,
) => Promise<void> {
  return async (event, context) => {
    const { tenantId, aggregateId: traceId, state: foldState } = context;

    if (!needsOriginResolution({ event, foldState })) return;

    // Defensive: a trace aggregate with an empty ID can't be resolved, and
    // scheduling one produces an OriginResolvedEvent with an empty
    // aggregateId that blows up the automations pipeline later.
    if (!traceId) {
      logger.warn(
        { tenantId, eventId: event.id, eventType: event.type },
        "Skipping deferred origin resolution: empty traceId on trace event",
      );
      return;
    }

    // No origin — schedule deferred resolution (5-min delay)
    logger.debug(
      { tenantId, traceId },
      "No origin resolved, scheduling deferred origin resolution",
    );
    await deps.scheduleDeferred({
      id: traceId,
      tenantId,
      traceId,
    });
  };
}

/**
 * Creates the deferred origin resolution handler.
 *
 * Fires after a 5-minute delay for pure OTEL traces that had no origin
 * at normal debounce time. Unconditionally dispatches a resolveOrigin
 * command with origin="application" — the command's idempotency key
 * and the fold projection's no-override guard handle duplicates.
 *
 * The resulting OriginResolvedEvent flows through:
 *   fold (sets origin if absent) → evaluationTrigger subscriber → dispatchEvaluations()
 */
export function createDeferredOriginHandler(
  resolveOrigin: (data: ResolveOriginCommandData) => Promise<void>,
) {
  return async (payload: DeferredOriginPayload): Promise<void> => {
    logger.debug(
      { tenantId: payload.tenantId, traceId: payload.traceId },
      "Deferred origin resolution: dispatching resolveOrigin command",
    );
    await resolveOrigin({
      tenantId: payload.tenantId,
      traceId: payload.traceId,
      origin: "application",
      reason: "deferred_fallback",
      occurredAt: Date.now(),
    });
  };
}

/** Dedup key for deferred origin resolution jobs */
export function makeDeferredJobId(payload: DeferredOriginPayload): string {
  return `deferred-origin:${payload.tenantId}:${payload.traceId}`;
}
