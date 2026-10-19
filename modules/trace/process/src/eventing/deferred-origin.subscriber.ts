import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  isSpanReceivedEvent,
  STALE_TRACE_THRESHOLD_MS,
  type ResolveOriginCommandData,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

export type DeferredOriginPayload = {
  id: string;
  tenantId: string;
  traceId: string;
};

const logger = createLogger("langwatch:trace-processing:origin-gate");

/** Main's job name, now a fold subscriber (queue key `subscriber:`, main's was `job:`). */
export const DEFERRED_ORIGIN_SUBSCRIBER_NAME = "deferredOriginResolution" as const;

export const DEFERRED_ORIGIN_DELAY_MS = 5 * 60 * 1000;

/**
 * Main's dedup, one job per trace: the first unresolved span sets the deadline
 * (extend: false) and later spans neither move it nor replace its payload.
 */
export const DEFERRED_ORIGIN_DEDUP = {
  makeId: (event: TraceProcessingEvent): string => `${event.tenantId}:${event.aggregateId}`,
  ttlMs: DEFERRED_ORIGIN_DELAY_MS + 60_000,
  extend: false,
  replace: false,
};

export function needsOriginResolution({
  event,
  foldState,
}: {
  event: TraceProcessingEvent;
  foldState: TraceSummaryData;
}): boolean {
  // Only a span arrival opens the gate: a clustering pass re-emits
  // topic_assigned stamped with the current time for its whole backlog, so
  // the staleness check below never catches it and months-old traces would
  // have the deferred fallback scheduled (#8191).
  if (!isSpanReceivedEvent(event)) return false;
  if (event.occurredAt < nowInstant().epochMilliseconds - STALE_TRACE_THRESHOLD_MS) return false;
  return !foldState.attributes?.["langwatch.origin"];
}

export function createDeferredOriginHandler(
  resolveOrigin: (data: ResolveOriginCommandData) => Promise<void>,
): (payload: DeferredOriginPayload) => Promise<void> {
  return async (payload) => {
    if (!payload.traceId) {
      logger.warn(
        { tenantId: payload.tenantId },
        "Skipping deferred origin resolution: empty traceId on trace event",
      );
      return;
    }
    logger.debug(
      { tenantId: payload.tenantId, traceId: payload.traceId },
      "Deferred origin resolution: dispatching resolveOrigin command",
    );
    await resolveOrigin({
      tenantId: payload.tenantId,
      traceId: payload.traceId,
      origin: "application",
      reason: "deferred_fallback",
      occurredAt: nowInstant().epochMilliseconds,
    });
  };
}
