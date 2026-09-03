import { histogram, type HistogramHandle } from "@langwatch/observability/metrics";

export type CodingAgentSessionListReadOutcome = "hit" | "empty" | "error";

/** Observes the bounded session-list storage read without coupling the feature to app metrics. */
export abstract class CodingAgentReadMetricsPort {
  abstract observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void;
}

export class NoopCodingAgentReadMetricsPort extends CodingAgentReadMetricsPort {
  static create(): NoopCodingAgentReadMetricsPort {
    return new NoopCodingAgentReadMetricsPort();
  }

  private constructor() {
    super();
  }

  observeSessionListRead(): void {}
}

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
export class OtelCodingAgentReadMetricsAdapter extends CodingAgentReadMetricsPort {
  static create(): OtelCodingAgentReadMetricsAdapter {
    return new OtelCodingAgentReadMetricsAdapter(
      histogram({
        name: CODING_AGENT_SESSION_LIST_READ_METRIC_NAME,
        description: "Duration of the bounded coding-agent session-list storage read",
      }),
    );
  }

  private constructor(private readonly readDuration: HistogramHandle) {
    super();
  }

  observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void {
    this.readDuration.observe(input.durationMs, { table: input.table, outcome: input.outcome });
  }
}
