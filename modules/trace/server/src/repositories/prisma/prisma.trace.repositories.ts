import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { resolvePlatformDefaultRetentionDays } from "@langwatch/data-retention-contract";
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
 * Live tier for Postgres repositories. Retention fallback resolves here so
 * both processes agree. See data-retention.config.ts.
 */
export class PostgresTraceRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      clickhouse: TraceClickHouseWriteResolver;
    }>,
  ): TraceRepositories {
    const storage = {
      resolveClient: members.clickhouse,
      defaultRetentionDays: resolvePlatformDefaultRetentionDays(process.env),
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
