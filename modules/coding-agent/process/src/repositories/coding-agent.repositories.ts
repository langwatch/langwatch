import type { CodingAgentSessionEventRepository } from "./coding-agent-session-event.repository.ts";
import type { CodingAgentSessionFoldCacheRepository } from "./coding-agent-session-fold-cache.repository.ts";
import type { CodingAgentSessionRepository } from "./coding-agent-session.repository.ts";
import type { CodingAgentTraceSessionRepository } from "./coding-agent-trace-session.repository.ts";
import type { CodingAgentSessionContextMemoRepository } from "./session-context-memo.repository.ts";
import type { SessionMetricSeriesRepository } from "./session-metric-series.repository.ts";

// Four repository projections of one fold; session and events must come from
// the same store.
export interface CodingAgentProjectionRepositories {
  readonly sessions: CodingAgentSessionRepository;
  readonly traceSessions: CodingAgentTraceSessionRepository;
  readonly metricSeries: SessionMetricSeriesRepository;
  readonly sessionEvents: CodingAgentSessionEventRepository;
}

/** The projections plus the fold's own scratch: its context memo and its cache. */
export interface CodingAgentRepositories extends CodingAgentProjectionRepositories {
  readonly sessionContextMemo: CodingAgentSessionContextMemoRepository;
  readonly sessionFoldCache: CodingAgentSessionFoldCacheRepository;
}
