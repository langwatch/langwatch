import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { TraceClickHouseWriteResolver } from "../../ports/clickhouse.port.ts";
import { TraceAnalyticsClickHouseRepository } from "../clickhouse/trace-metrics-analytics.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../clickhouse/trace-analytics-rollup.repository.ts";
import {
  TraceSummaryClickHouseRepository,
  TraceSummaryProjectionClickHouseRepository,
} from "../clickhouse/trace-summary.repository.ts";
import { ClickHouseTraceExistenceRepository } from "../clickhouse/trace-existence.repository.ts";
import { LogRecordStorageClickHouseRepository } from "../clickhouse/log-record-storage.repository.ts";
import { SpanStorageClickHouseRepository } from "../clickhouse/span-storage.repository.ts";
import { TraceDerivationSpanClickHouseRepository } from "../clickhouse/trace-derivation-span.repository.ts";
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
      spanStorage: SpanStorageClickHouseRepository.create(infrastructure.clickhouse),
      existence: ClickHouseTraceExistenceRepository.create({
        resolveClient: infrastructure.clickhouse,
      }),
      derivationSpans: TraceDerivationSpanClickHouseRepository.create({
        resolveClient: infrastructure.clickhouse,
      }),
      summary: TraceSummaryClickHouseRepository.create(storage),
      logRecords: LogRecordStorageClickHouseRepository.create(infrastructure.clickhouse),
    };
  }
}
