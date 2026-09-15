import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { MemoryCodingAgentDatabase } from "./memory.coding-agent.database.ts";
import { MemoryCodingAgentSessionEventRepository } from "./memory.coding-agent-session-event.repository.ts";
import { MemoryCodingAgentSessionRepository } from "./memory.coding-agent-session.repository.ts";
import { MemoryCodingAgentTraceSessionRepository } from "./memory.coding-agent-trace-session.repository.ts";
import { MemorySessionMetricSeriesRepository } from "./memory.session-metric-series.repository.ts";

/** The "memory" tier: every coding-agent row the app is tested without a store. */
export class MemoryCodingAgentRepositories {
  static readonly requires = [] as const;

  static create(): CodingAgentRepositories {
    // One store behind all four rows, the way one ClickHouse endpoint holds
    // them: a session folded through `sessions` is what `traceSessions` and
    // `sessionEvents` are read against in the same test.
    const memory = MemoryCodingAgentDatabase.create();

    return {
      sessions: MemoryCodingAgentSessionRepository.create(memory),
      traceSessions: MemoryCodingAgentTraceSessionRepository.create(memory),
      metricSeries: MemorySessionMetricSeriesRepository.create(memory),
      sessionEvents: MemoryCodingAgentSessionEventRepository.create(memory),
    };
  }
}
