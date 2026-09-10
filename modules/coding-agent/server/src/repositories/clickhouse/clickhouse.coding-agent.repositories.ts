import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { NoopCodingAgentReadMetrics } from "../../services/coding-agent-read-metrics-noop.service.ts";
import type { CodingAgentReadMetrics } from "../../app/coding-agent.members.ts";
import { SystemCodingAgentClockAdapter } from "../../services/coding-agent-clock.service.ts";
import type { CodingAgentClock } from "../../app/coding-agent.members.ts";
import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { CodingAgentSessionClickHouseRepository } from "./clickhouse.coding-agent-session.repository.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "./clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "./clickhouse.coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesClickHouseRepository } from "./clickhouse.session-metric-series.repository.ts";

/**
 * The retention horizon a row keeps when its writer names none.
 *
 * It is the 308 days the tables' own `_retention_days` column defaults to
 * (migration 00051), so a row written without one keeps the horizon the schema
 * already states rather than a second number this module invented.
 *
 * It is a constant rather than a member because `requires` may only name
 * process members and retention is not one, and nothing on the fold path
 * reaches it: `CodingAgentProjectionPersistenceService` names the tenant's own
 * retention on every write. A test that needs a different horizon says so
 * through {@link ClickHouseCodingAgentRepositories.createWith}.
 */
const DEFAULT_RETENTION_DAYS = 308;

/** What a process hands the live tier: the one client it routes through. */
export type ClickHouseCodingAgentInfrastructure = Readonly<{
  clickhouse: ClickHouseQueryClient;
}>;

/**
 * The live tier. Every coding-agent row is a projection in one tenant-keyed
 * ClickHouse, reached through the process's single client: this tier resolves
 * no endpoint and holds no per-tenant client, because every statement its
 * repositories issue names the tenant it belongs to and the client places it.
 */
export class ClickHouseCodingAgentRepositories {
  static readonly requires = ["clickhouse"] as const;

  static create(members: ClickHouseCodingAgentInfrastructure): CodingAgentRepositories {
    return ClickHouseCodingAgentRepositories.createWith(members);
  }

  /**
   * The same tier with the retention default, the read metrics and the clock
   * named. The provider entry above takes members alone, because a boot
   * selection carries only what the process declared; a test that has to
   * control time or the retention horizon says so here.
   */
  static createWith(
    options: ClickHouseCodingAgentInfrastructure &
      Readonly<{
        defaultRetentionDays?: number;
        metrics?: CodingAgentReadMetrics;
        clock?: CodingAgentClock;
      }>,
  ): CodingAgentRepositories {
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
