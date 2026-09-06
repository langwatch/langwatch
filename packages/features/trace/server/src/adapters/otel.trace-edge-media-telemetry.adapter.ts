import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import {
  type TraceEdgeMediaFailOpenReason,
  TraceEdgeMediaTelemetryPort,
} from "../ports/trace-media-store.port.ts";

export const TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME =
  "langwatch_edge_media_extract_fail_open_total";

/**
 * The one series edge media extraction reports, pushed over OTLP.
 *
 * It was declared in the platform application's `server/metrics.ts` while that
 * process supplied the port. It lives beside the port now, and the API's trace
 * ingest composition supplies it wherever it composes media extraction. The port
 * stays optional on the extraction service (`telemetry?:`, called through `?.`),
 * so a caller that passes none still reports nothing.
 */
export class OtelTraceEdgeMediaTelemetryAdapter extends TraceEdgeMediaTelemetryPort {
  static create(): OtelTraceEdgeMediaTelemetryAdapter {
    return new OtelTraceEdgeMediaTelemetryAdapter(
      counter({
        name: TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME,
        description: "Count of edge media-extraction fail-open events by failing stage",
      }),
    );
  }

  private constructor(private readonly failOpenTotal: CounterHandle) {
    super();
  }

  failOpen(reason: TraceEdgeMediaFailOpenReason, count = 1): void {
    this.failOpenTotal.inc({ reason }, count);
  }
}
