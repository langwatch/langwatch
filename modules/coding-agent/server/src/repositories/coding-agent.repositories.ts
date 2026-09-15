import type { CodingAgentSessionEventRepository } from "./coding-agent-session-event.repository.ts";
import type { CodingAgentSessionRepository } from "./coding-agent-session.repository.ts";
import type { CodingAgentTraceSessionRepository } from "./coding-agent-trace-session.repository.ts";
import type { SessionMetricSeriesRepository } from "./session-metric-series.repository.ts";

// Four repository projections of one fold; session and events must come from
// same store; memo is fold's scratch in Redis, not here.
export interface CodingAgentRepositories {
  readonly sessions: CodingAgentSessionRepository;
  readonly traceSessions: CodingAgentTraceSessionRepository;
  readonly metricSeries: SessionMetricSeriesRepository;
  readonly sessionEvents: CodingAgentSessionEventRepository;
}
