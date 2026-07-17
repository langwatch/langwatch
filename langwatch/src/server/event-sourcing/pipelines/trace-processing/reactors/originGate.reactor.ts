import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { ResolveOriginCommandData } from "../schemas/commands";
import { STALE_TRACE_THRESHOLD_MS } from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";
import type { TraceSummarySubscriber } from "./_originGuardedSubscriber";

const logger = createLogger("langwatch:trace-processing:origin-gate-reactor");

/** Delay (ms) before the deferred origin resolution fires */
export const DEFERRED_CHECK_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export type DeferredOriginPayload = {
  id: string; // traceId — used as staged job ID for debuggability
  tenantId: string;
  traceId: string;
};

export interface OriginGateReactorDeps {
  scheduleDeferred: (payload: DeferredOriginPayload) => Promise<void>;
}

/**
 * Ensures every trace gets an origin resolved.
 *
 * Fires on every trace event (via traceSummary fold). If origin is already
 * set (explicit, legacy markers, or SDK heuristic), this is a no-op.
 * If absent (pure OTEL traces), schedules a 5-minute deferred origin
 * resolution job.
 *
 * Completely decoupled from evaluation dispatch — evaluationTrigger
 * handles that independently.
 */
/**
 * Pure relevance guard, run at the top of the handler (its event-only stale
 * check also runs pre-enqueue via `when`): skip stale resync traces and
 * traces whose origin is already resolved.
 */
function needsOriginResolution(
  event: TraceProcessingEvent,
  foldState: TraceSummaryData,
): boolean {
  if (event.occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  return !foldState.attributes?.["langwatch.origin"];
}

export function createOriginGateReactor(
  deps: OriginGateReactorDeps,
): TraceSummarySubscriber {
  return {
    name: "originGate",
    spec: {
      fold: "traceSummary",
      // Pre-enqueue: only the event-only half of the guard can run here; the
      // fold-state half (origin already resolved) re-runs in the handler.
      when: (event) =>
        event.occurredAt >= Date.now() - STALE_TRACE_THRESHOLD_MS,
      ttl: 15_000, // 15s dedup — debounce multi-span trace bursts
      delay: 5_000, // 5s delay — settle before checking origin
      handler: async (event, context) => {
        const { tenantId, aggregateId: traceId, state } = context;

        if (!needsOriginResolution(event, state)) return;

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
      },
    },
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
 *   fold (sets origin if absent) → evaluationTrigger reactor → dispatchEvaluations()
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
