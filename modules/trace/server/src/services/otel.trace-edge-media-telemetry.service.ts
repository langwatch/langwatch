import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import {
  type TraceEdgeMediaFailOpenReason,
  type TraceEdgeMediaTelemetry,
} from "../app/trace.members.ts";

export const TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME =
  "langwatch_edge_media_extract_fail_open_total";

/**
 * Metrics for edge media extraction; optional in the extraction service.
 */
export class OtelTraceEdgeMediaTelemetryAdapter implements TraceEdgeMediaTelemetry {
  static create(): OtelTraceEdgeMediaTelemetryAdapter {
    return new OtelTraceEdgeMediaTelemetryAdapter(
      counter({
        name: TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME,
        description: "Count of edge media-extraction fail-open events by failing stage",
      }),
    );
  }

  private constructor(private readonly failOpenTotal: CounterHandle) {
  }

  failOpen(reason: TraceEdgeMediaFailOpenReason, count = 1): void {
    this.failOpenTotal.inc({ reason }, count);
  }
}
