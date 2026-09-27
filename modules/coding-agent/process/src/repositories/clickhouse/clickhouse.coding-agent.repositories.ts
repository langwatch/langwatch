import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Instant } from "@langwatch/time";

import { CODING_AGENT_SESSION_LIST_READ_METRIC_NAME } from "../../rules/coding-agent-read-metrics.rules.ts";
import type { CodingAgentProjectionRepositories } from "../coding-agent.repositories.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "./clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "./clickhouse.coding-agent-session.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "./clickhouse.coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesClickHouseRepository } from "./clickhouse.session-metric-series.repository.ts";

// Default retention (308 days) mirrors schema defaults; not a process member
// so tests override via createWith().
const DEFAULT_RETENTION_DAYS = 308;

/** The process's clock member, as far as this tier reads it. */
export type CodingAgentProcessClock = Readonly<{ now(): Instant }>;

/** The process's telemetry member, as far as this tier reports to it. */
export type CodingAgentProcessTelemetry = Readonly<{
  observe(name: string, value: number, attributes?: Readonly<Record<string, string>>): void;
}>;

/** What a process hands this tier: the one client it routes through, its clock and telemetry. */
export type ClickHouseCodingAgentInfrastructure = Readonly<{
  clickhouse: ClickHouseQueryClient;
  clock: CodingAgentProcessClock;
  telemetry: CodingAgentProcessTelemetry;
}>;

/**
 * The ClickHouse tier: every coding-agent row is a projection in one tenant-keyed
 * ClickHouse, reached through the process's single client. No endpoint or
 * per-tenant client here — every statement names its own tenant.
 */
export class ClickHouseCodingAgentRepositories {
  static readonly requires = ["clickhouse", "clock", "telemetry"] as const;

  /** A test states a retention default; a boot selection carries only the members. */
  static create(
    members: ClickHouseCodingAgentInfrastructure & Readonly<{ defaultRetentionDays?: number }>,
  ): CodingAgentProjectionRepositories {
    const storage = {
      clickhouse: members.clickhouse,
      defaultTraceRetentionDays: members.defaultRetentionDays ?? DEFAULT_RETENTION_DAYS,
    };

    return {
      sessions: CodingAgentSessionClickHouseRepository.create({
        ...storage,
        metrics: {
          observeSessionListRead: ({ table, outcome, durationMs }) =>
            members.telemetry.observe(CODING_AGENT_SESSION_LIST_READ_METRIC_NAME, durationMs, {
              table,
              outcome,
            }),
        },
        clock: { nowMs: () => members.clock.now().epochMilliseconds },
      }),
      traceSessions: CodingAgentTraceSessionClickHouseRepository.create(storage),
      metricSeries: SessionMetricSeriesClickHouseRepository.create(storage),
      sessionEvents: CodingAgentSessionEventsClickHouseRepository.create(storage),
    };
  }
}
