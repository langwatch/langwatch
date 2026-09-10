import { histogram, type HistogramHandle } from "@langwatch/observability/metrics";
import {
  CodingAgentReadMetrics,
  type CodingAgentSessionListReadOutcome,
} from "../app/coding-agent.members.ts";

export const CODING_AGENT_SESSION_LIST_READ_METRIC_NAME =
  "coding_agent_session_list_read_duration_milliseconds";

/**
 * The read-duration series, pushed over OTLP.
 *
 * It was declared in the platform application's `server/metrics.ts` while that
 * process supplied the port; it lives beside the port now. Its bucket
 * boundaries are already reserved under this exact name in
 * `@langwatch/observability`'s `HISTOGRAM_BOUNDARIES`. Nothing composes it
 * yet — `CodingAgentAdapter` defaults to the Noop above — so the series is
 * unpublished until a root passes `readMetrics`.
 */
export class OtelCodingAgentReadMetricsAdapter implements CodingAgentReadMetrics {
  static create(): OtelCodingAgentReadMetricsAdapter {
    return new OtelCodingAgentReadMetricsAdapter(
      histogram({
        name: CODING_AGENT_SESSION_LIST_READ_METRIC_NAME,
        description: "Duration of the bounded coding-agent session-list storage read",
      }),
    );
  }

  private constructor(private readonly readDuration: HistogramHandle) {
  }

  observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void {
    this.readDuration.observe(input.durationMs, { table: input.table, outcome: input.outcome });
  }
}
