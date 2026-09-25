import { histogram, type HistogramHandle } from "@langwatch/observability/metrics";

import type {
  CodingAgentReadMetrics,
  CodingAgentSessionListReadOutcome,
} from "../app/coding-agent.members.ts";

export const CODING_AGENT_SESSION_LIST_READ_METRIC_NAME =
  "coding_agent_session_list_read_duration_milliseconds";

/** Read-duration histogram; unpublished until root passes readMetrics. */
export class OtelCodingAgentReadMetricsService implements CodingAgentReadMetrics {
  static create(): OtelCodingAgentReadMetricsService {
    return new OtelCodingAgentReadMetricsService(
      histogram({
        name: CODING_AGENT_SESSION_LIST_READ_METRIC_NAME,
        description: "Duration of the bounded coding-agent session-list storage read",
      }),
    );
  }

  private constructor(private readonly readDuration: HistogramHandle) {}

  observeSessionListRead(input: {
    table: string;
    outcome: CodingAgentSessionListReadOutcome;
    durationMs: number;
  }): void {
    this.readDuration.observe(input.durationMs, { table: input.table, outcome: input.outcome });
  }
}
