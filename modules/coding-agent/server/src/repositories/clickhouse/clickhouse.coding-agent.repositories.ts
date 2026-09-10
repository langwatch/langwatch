import { NoopCodingAgentReadMetricsPort } from "../../adapters/coding-agent-read-metrics.adapter.ts";
import type { CodingAgentReadMetricsPort } from "../../ports/coding-agent-read-metrics.port.ts";
import { SystemCodingAgentClockAdapter } from "../../adapters/coding-agent-clock.adapter.ts";
import type { CodingAgentClickHousePort } from "../../ports/coding-agent-clickhouse.port.ts";
import type { CodingAgentClockPort } from "../../ports/coding-agent-clock.port.ts";
import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { CodingAgentSessionClickHouseRepository } from "./clickhouse.coding-agent-session.repository.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "./clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "./clickhouse.coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesClickHouseRepository } from "./clickhouse.session-metric-series.repository.ts";

/** What a process hands the ClickHouse tier. */
export type ClickHouseCodingAgentInfrastructure = Readonly<{
  clickhouse: CodingAgentClickHousePort;
  defaultRetentionDays: number;
}>;

/**
 * The "clickhouse" tier: every coding-agent row lives in one tenant-keyed
 * ClickHouse endpoint, so the tier is named for that store rather than for a
 * Postgres it never reaches.
 */
export class ClickHouseCodingAgentRepositories {
  static readonly requires = ["clickhouse", "defaultRetentionDays"] as const;

  static create(infrastructure: ClickHouseCodingAgentInfrastructure): CodingAgentRepositories {
    return ClickHouseCodingAgentRepositories.createWith(infrastructure);
  }

  /**
   * The same tier with the read metrics and the clock named. The provider entry
   * above takes infrastructure alone, because a boot selection carries only
   * what the process declared; a test that has to control time says so here.
   */
  static createWith(
    options: ClickHouseCodingAgentInfrastructure &
      Readonly<{ metrics?: CodingAgentReadMetricsPort; clock?: CodingAgentClockPort }>,
  ): CodingAgentRepositories {
    const storage = {
      clickHouse: options.clickhouse,
      defaultTraceRetentionDays: options.defaultRetentionDays,
    };

    return {
      sessions: CodingAgentSessionClickHouseRepository.create({
        ...storage,
        metrics: options.metrics ?? NoopCodingAgentReadMetricsPort.create(),
        clock: options.clock ?? SystemCodingAgentClockAdapter.create(),
      }),
      traceSessions: CodingAgentTraceSessionClickHouseRepository.create(storage),
      metricSeries: SessionMetricSeriesClickHouseRepository.create(storage),
      sessionEvents: CodingAgentSessionEventsClickHouseRepository.create(storage),
    };
  }
}
