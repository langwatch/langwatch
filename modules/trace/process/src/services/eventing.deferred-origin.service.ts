import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import {
  isSpanReceivedEvent,
  STALE_TRACE_THRESHOLD_MS,
  type ResolveOriginCommandData,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import type { DeferredOriginPayload } from "../app/trace.members.ts";

const logger = createLogger("langwatch:trace-processing:origin-gate");

export const DEFERRED_ORIGIN_CHECK_DELAY_MS = 5 * 60 * 1000;

export class TraceDeferredOriginEventingAdapter {
  static create(): TraceDeferredOriginEventingAdapter {
    return new TraceDeferredOriginEventingAdapter();
  }

  static needsOriginResolution({
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

  static createDeferredOriginHandler(
    resolveOrigin: (data: ResolveOriginCommandData) => Promise<void>,
  ): (payload: DeferredOriginPayload) => Promise<void> {
    return async (payload) => {
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
}
