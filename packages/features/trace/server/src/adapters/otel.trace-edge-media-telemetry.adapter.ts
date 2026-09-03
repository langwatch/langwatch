import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import {
  type TraceEdgeMediaFailOpenReason,
  TraceEdgeMediaTelemetryPort,
} from "../ports/trace-media-store.port";

export const TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME =
  "langwatch_edge_media_extract_fail_open_total";

/**
 * The one series edge media extraction reports, pushed over OTLP.
 *
 * It was declared in the platform application's `server/metrics.ts` while that
 * process supplied the port. It lives beside the port now. The port itself is
 * optional on the extraction service (`telemetry?:`, called through `?.`), and
 * no root supplies it, so absent still means unreported — which is what the
 * port's own docblock says.
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
