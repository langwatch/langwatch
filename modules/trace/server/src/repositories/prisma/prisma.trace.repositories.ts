import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { TraceClickHouseWriteResolver } from "../trace-clickhouse-client.repository.ts";
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
import { SessionGroupsClickHouseRepository } from "../clickhouse/session-groups.repository.ts";
import { TraceListClickHouseRepository } from "../clickhouse/trace-list.repository.ts";
import { ClickHouseTraceEventPayloadRepository } from "../clickhouse/trace-event-payload.repository.ts";

/**
 * The live tier. The tier is named for the store every row the module
 * keeps outside ClickHouse lives in; the three projections need the
 * tenant-keyed ClickHouse connection as well, so both are required inputs of
 * the one tier.
 */
export class PostgresTraceRepositories {
  static readonly requires = ["prisma", "clickhouse", "defaultRetentionDays"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      clickhouse: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
    }>,
  ): TraceRepositories {
    const storage = {
      resolveClient: members.clickhouse,
      defaultRetentionDays: members.defaultRetentionDays,
    };

    return {
      editOverlay: PrismaTraceEditOverlayRepository.create(members.prisma),
      summaryProjection: TraceSummaryProjectionClickHouseRepository.create(storage),
      analyticsProjection: TraceAnalyticsClickHouseRepository.create(storage),
      analyticsRollup: TraceAnalyticsRollupClickHouseRepository.create(storage),
      spanStorage: SpanStorageClickHouseRepository.create(members.clickhouse),
      existence: ClickHouseTraceExistenceRepository.create({
        resolveClient: members.clickhouse,
      }),
      derivationSpans: TraceDerivationSpanClickHouseRepository.create({
        resolveClient: members.clickhouse,
      }),
      summary: TraceSummaryClickHouseRepository.create(storage),
      logRecords: LogRecordStorageClickHouseRepository.create(members.clickhouse),
      list: TraceListClickHouseRepository.create(members.clickhouse),
      sessionGroups: SessionGroupsClickHouseRepository.create(members.clickhouse),
      eventPayloads: ClickHouseTraceEventPayloadRepository.createResolved({
        resolveClient: members.clickhouse,
      }),
    };
  }
}
