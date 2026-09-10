import type { CodingAgentSessionEventRepository } from "./coding-agent-session-event.repository.ts";
import type { CodingAgentSessionRepository } from "./coding-agent-session.repository.ts";
import type { CodingAgentTraceSessionRepository } from "./coding-agent-trace-session.repository.ts";
import type { SessionMetricSeriesRepository } from "./session-metric-series.repository.ts";

/**
 * The rows the coding-agent module owns, chosen once at boot.
 *
 * All four are projections of one fold, so they are one tier rather than four
 * selections: a session row and the event rows it was folded from must come
 * from the same store or a read answers from half a fold.
 *
 * The session-context memo is not here. It is the fold's own scratch row in
 * Redis, written and read inside the processing pipeline and never by the
 * application, so a read-only process composes the four without a Redis.
 */
export interface CodingAgentRepositories {
  readonly sessions: CodingAgentSessionRepository;
  readonly traceSessions: CodingAgentTraceSessionRepository;
  readonly metricSeries: SessionMetricSeriesRepository;
  readonly sessionEvents: CodingAgentSessionEventRepository;
}
