import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { TraceClickHouseWriteResolver } from "../../ports/clickhouse.port.ts";
import { TraceAnalyticsClickHouseRepository } from "../clickhouse/trace-metrics-analytics.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../clickhouse/trace-analytics-rollup.repository.ts";
import { TraceSummaryProjectionClickHouseRepository } from "../clickhouse/trace-summary.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";
import { PrismaTraceEditOverlayRepository } from "./prisma.trace-edit-overlay.repository.ts";

/**
 * The "postgres" tier. The tier is named for the store every row the module
 * keeps outside ClickHouse lives in; the three projections need the
 * tenant-keyed ClickHouse connection as well, so both are required inputs of
 * the one tier.
 */
export class PostgresTraceRepositories {
  static readonly requires = ["prisma", "clickhouse", "defaultRetentionDays"] as const;

  static create(
    infrastructure: Readonly<{
      prisma: PrismaClient;
      clickhouse: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
    }>,
  ): TraceRepositories {
    const storage = {
      resolveClient: infrastructure.clickhouse,
      defaultRetentionDays: infrastructure.defaultRetentionDays,
    };

    return {
      editOverlay: PrismaTraceEditOverlayRepository.create(infrastructure.prisma),
      summaryProjection: TraceSummaryProjectionClickHouseRepository.create(storage),
      analyticsProjection: TraceAnalyticsClickHouseRepository.create(storage),
      analyticsRollup: TraceAnalyticsRollupClickHouseRepository.create(storage),
    };
  }
}
