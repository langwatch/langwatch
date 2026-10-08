import { counter, type CounterHandle } from "@langwatch/observability/metrics";

/** The fail-open reasons the edge extraction reports. First three: hook
 * standing down (flag store, privacy probe, store refusal). Last three: budget
 * outcomes (per-span cap, deadline, part store). */
type TraceEdgeMediaFailOpenReason =
  | "flag_store"
  | "privacy_probe"
  | "storage"
  | "part_cap"
  | "deadline"
  | "part_store";

/** The one series the edge extraction reports. Absent means unreported. */
export interface TraceEdgeMediaTelemetry {
  failOpen(reason: TraceEdgeMediaFailOpenReason, count?: number): void;
}

const TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME = "langwatch_edge_media_extract_fail_open_total";

/**
 * Metrics for edge media extraction; optional in the extraction service.
 */
export class TraceEdgeMediaTelemetryService implements TraceEdgeMediaTelemetry {
  static create(): TraceEdgeMediaTelemetryService {
    return new TraceEdgeMediaTelemetryService(
      counter({
        name: TRACE_EDGE_MEDIA_FAIL_OPEN_METRIC_NAME,
        description: "Count of edge media-extraction fail-open events by failing stage",
      }),
    );
  }

  private constructor(private readonly failOpenTotal: CounterHandle) {}

  failOpen(reason: TraceEdgeMediaFailOpenReason, count = 1): void {
    this.failOpenTotal.inc({ reason }, count);
  }
}
