import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import type { CodingAgentReadMetrics, CodingAgentClock } from "../../app/coding-agent.members.ts";
import { SystemCodingAgentClockAdapter } from "../../services/coding-agent-clock.service.ts";
import { NoopCodingAgentReadMetrics } from "../../services/coding-agent-read-metrics-noop.service.ts";
import type { CodingAgentProjectionRepositories } from "../coding-agent.repositories.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "./clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "./clickhouse.coding-agent-session.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "./clickhouse.coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesClickHouseRepository } from "./clickhouse.session-metric-series.repository.ts";

// Default retention (308 days) mirrors schema defaults; not a process member
// so tests override via createWith().
const DEFAULT_RETENTION_DAYS = 308;

/** What a process hands the live tier: the one client it routes through. */
export type ClickHouseCodingAgentInfrastructure = Readonly<{
  clickhouse: ClickHouseQueryClient;
}>;

/**
 * The live tier: every coding-agent row is a projection in one tenant-keyed
 * ClickHouse, reached through the process's single client. No endpoint or
 * per-tenant client here — every statement names its own tenant.
 */
export class ClickHouseCodingAgentRepositories {
  static create(members: ClickHouseCodingAgentInfrastructure): CodingAgentProjectionRepositories {
    return ClickHouseCodingAgentRepositories.createWith(members);
  }

  /**
   * The same tier with retention default, read metrics and clock named. The
   * provider entry above takes members alone — a boot selection carries only
   * what the process declared; a test controlling time or retention says so here.
   */
  static createWith(
    options: ClickHouseCodingAgentInfrastructure &
      Readonly<{
        defaultRetentionDays?: number;
        metrics?: CodingAgentReadMetrics;
        clock?: CodingAgentClock;
      }>,
  ): CodingAgentProjectionRepositories {
    const storage = {
      clickhouse: options.clickhouse,
      defaultTraceRetentionDays: options.defaultRetentionDays ?? DEFAULT_RETENTION_DAYS,
    };

    return {
      sessions: CodingAgentSessionClickHouseRepository.create({
        ...storage,
        metrics: options.metrics ?? NoopCodingAgentReadMetrics.create(),
        clock: options.clock ?? SystemCodingAgentClockAdapter.create(),
      }),
      traceSessions: CodingAgentTraceSessionClickHouseRepository.create(storage),
      metricSeries: SessionMetricSeriesClickHouseRepository.create(storage),
      sessionEvents: CodingAgentSessionEventsClickHouseRepository.create(storage),
    };
  }
}
