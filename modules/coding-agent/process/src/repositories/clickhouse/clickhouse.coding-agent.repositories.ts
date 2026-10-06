import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { histogram } from "@langwatch/observability/metrics";
import { nowInstant } from "@langwatch/time";

import { CODING_AGENT_SESSION_LIST_READ_METRIC_NAME } from "../../rules/coding-agent-read-metrics.rules.ts";
import type { CodingAgentClock } from "../../services/coding-agent-clock.service.ts";
import type { CodingAgentProjectionRepositories } from "../coding-agent.repositories.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "./clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "./clickhouse.coding-agent-session.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "./clickhouse.coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesClickHouseRepository } from "./clickhouse.session-metric-series.repository.ts";

// Default retention (308 days) mirrors schema defaults; a test overrides it
// through create().
const DEFAULT_RETENTION_DAYS = 308;

/**
 * The ClickHouse tier: every coding-agent row is a projection in one tenant-keyed
 * ClickHouse, reached through the process's single client. No endpoint or
 * per-tenant client here — every statement names its own tenant.
 */
export class ClickHouseCodingAgentRepositories {
  static readonly requires = ["clickhouse"] as const;

  /** A test states a retention default or a clock; a boot selection carries only the client. */
  static create({
    clickhouse,
    defaultRetentionDays = DEFAULT_RETENTION_DAYS,
    clock = { nowMs: () => nowInstant().epochMilliseconds },
  }: {
    clickhouse: ClickHouseQueryClient;
    defaultRetentionDays?: number;
    clock?: CodingAgentClock;
  }): CodingAgentProjectionRepositories {
    const storage = { clickhouse, defaultTraceRetentionDays: defaultRetentionDays };
    const sessionListReadDuration = histogram({
      name: CODING_AGENT_SESSION_LIST_READ_METRIC_NAME,
      description: "Duration of the bounded coding-agent session-list storage read",
    });

    return {
      sessions: CodingAgentSessionClickHouseRepository.create({
        ...storage,
        metrics: {
          observeSessionListRead: ({ table, outcome, durationMs }) =>
            sessionListReadDuration.observe(durationMs, { table, outcome }),
        },
        clock,
      }),
      traceSessions: CodingAgentTraceSessionClickHouseRepository.create(storage),
      metricSeries: SessionMetricSeriesClickHouseRepository.create(storage),
      sessionEvents: CodingAgentSessionEventsClickHouseRepository.create(storage),
    };
  }
}
