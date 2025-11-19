import type { EventHandler, EventStream } from "../../../library";
import type { Projection } from "../../../library";
import type { TraceAggregationEvent } from "../../../types/events/traceAggregation";
import {
  isTraceAggregationStartedEvent,
  isTraceAggregationCompletedEvent,
  isTraceAggregationCancelledEvent,
} from "../../../types/events/traceAggregation";

/**
 * Projection data for trace aggregation state.
 * Tracks the status of aggregation operations, not the trace itself.
 * When completed, includes all aggregated trace data.
 */
export interface TraceAggregationStateProjectionData {
  aggregationStatus: "idle" | "in_progress" | "completed";
  startedAt?: number;
  completedAt?: number;
  // Fields from TraceAggregationCompletedEventData (populated when completed)
  traceId?: string;
  spanIds?: string[];
  totalSpans?: number;
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
  durationMs?: number;
  serviceNames?: string[];
  rootSpanId?: string | null;
}

/**
 * Projection for tracking trace aggregation state.
 */
export interface TraceAggregationStateProjection
  extends Projection<TraceAggregationStateProjectionData> {
  data: TraceAggregationStateProjectionData;
}

/**
 * Event handler that builds the trace aggregation state projection.
 * Tracks the current state of trace aggregation based on events.
 */
export class TraceAggregationStateProjectionHandler
  implements
    EventHandler<TraceAggregationEvent, TraceAggregationStateProjection>
{
  /**
   * Validates that a timestamp is valid (not 0, null, undefined, or negative).
   */
  private isValidTimestamp(timestamp: number | undefined | null): boolean {
    return (
      typeof timestamp === "number" &&
      timestamp > 0 &&
      isFinite(timestamp) &&
      !isNaN(timestamp)
    );
  }

  handle(
    stream: EventStream<
      TraceAggregationEvent["tenantId"],
      TraceAggregationEvent
    >,
  ): TraceAggregationStateProjection {
    const events = stream.getEvents();
    const aggregateId = stream.getAggregateId();
    const tenantId = stream.getTenantId();

    // Initialize with idle state
    let state: TraceAggregationStateProjectionData = {
      aggregationStatus: "idle",
    };

    // Process events in order
    for (const event of events) {
      if (isTraceAggregationStartedEvent(event)) {
        state = {
          aggregationStatus: "in_progress",
          startedAt: event.timestamp,
        };
      } else if (isTraceAggregationCompletedEvent(event)) {
        // Validate timestamps before storing - only include if valid
        const startTimeUnixMs = this.isValidTimestamp(
          event.data.startTimeUnixMs,
        )
          ? event.data.startTimeUnixMs
          : undefined;
        const endTimeUnixMs = this.isValidTimestamp(event.data.endTimeUnixMs)
          ? event.data.endTimeUnixMs
          : undefined;
        const durationMs =
          startTimeUnixMs !== undefined && endTimeUnixMs !== undefined
            ? endTimeUnixMs - startTimeUnixMs
            : undefined;

        // Store full aggregated data when completed
        state = {
          aggregationStatus: "completed",
          startedAt: state.startedAt ?? event.timestamp,
          completedAt: event.timestamp,
          traceId: event.data.traceId,
          spanIds: event.data.spanIds,
          totalSpans: event.data.totalSpans,
          startTimeUnixMs,
          endTimeUnixMs,
          durationMs,
          serviceNames: event.data.serviceNames,
          rootSpanId: event.data.rootSpanId,
        };
      } else if (isTraceAggregationCancelledEvent(event)) {
        // Reset to idle when cancelled
        state = {
          aggregationStatus: "idle",
        };
      }
    }

    // Get the latest event timestamp for version
    const lastEvent = events[events.length - 1];
    const version = lastEvent ? lastEvent.timestamp : Date.now();

    return {
      id: `trace-aggregation-state:${aggregateId}`,
      aggregateId,
      tenantId,
      version,
      data: state,
    };
  }
}
