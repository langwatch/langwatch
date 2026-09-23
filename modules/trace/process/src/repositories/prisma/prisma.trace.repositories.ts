import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { resolvePlatformDefaultRetentionDays } from "@langwatch/data-retention-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { MemberTraceClickHouseClientRepository } from "../clickhouse/clickhouse.trace-member-client.repository.ts";
import { LogRecordStorageClickHouseRepository } from "../clickhouse/log-record-storage.repository.ts";
import { SessionGroupsClickHouseRepository } from "../clickhouse/session-groups.repository.ts";
import { SpanStorageClickHouseRepository } from "../clickhouse/span-storage.repository.ts";
import { TraceAnalyticsRollupClickHouseRepository } from "../clickhouse/trace-analytics-rollup.repository.ts";
import { TraceDerivationSpanClickHouseRepository } from "../clickhouse/trace-derivation-span.repository.ts";
import { ClickHouseTraceEventPayloadRepository } from "../clickhouse/trace-event-payload.repository.ts";
import { ClickHouseTraceExistenceRepository } from "../clickhouse/trace-existence.repository.ts";
import { TraceListClickHouseRepository } from "../clickhouse/trace-list.repository.ts";
import { TraceAnalyticsClickHouseRepository } from "../clickhouse/trace-metrics-analytics.repository.ts";
import {
  TraceSummaryClickHouseRepository,
  TraceSummaryProjectionClickHouseRepository,
} from "../clickhouse/trace-summary.repository.ts";
import type { TraceRepositories } from "../trace.repositories.ts";
import { PrismaTraceEditOverlayRepository } from "./prisma.trace-edit-overlay.repository.ts";

/**
 * Live tier for Postgres repositories. Retention fallback resolves here so
 * both processes agree. See data-retention.config.ts.
 */
export class PostgresTraceRepositories {
  static readonly requires = ["prisma", "clickhouse"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      clickhouse: ClickHouseQueryClient;
    }>,
  ): TraceRepositories {
    const traceClickHouse = MemberTraceClickHouseClientRepository.resolverFor(members.clickhouse);
    const storage = {
      resolveClient: traceClickHouse,
      defaultRetentionDays: resolvePlatformDefaultRetentionDays(process.env),
    };

    return {
      editOverlay: PrismaTraceEditOverlayRepository.create(members.prisma),
      summaryProjection: TraceSummaryProjectionClickHouseRepository.create(storage),
      analyticsProjection: TraceAnalyticsClickHouseRepository.create(storage),
      analyticsRollup: TraceAnalyticsRollupClickHouseRepository.create(storage),
      spanStorage: SpanStorageClickHouseRepository.create(traceClickHouse),
      existence: ClickHouseTraceExistenceRepository.create({
        resolveClient: traceClickHouse,
      }),
      derivationSpans: TraceDerivationSpanClickHouseRepository.create({
        resolveClient: traceClickHouse,
      }),
      summary: TraceSummaryClickHouseRepository.create(storage),
      logRecords: LogRecordStorageClickHouseRepository.create(traceClickHouse),
      list: TraceListClickHouseRepository.create(traceClickHouse),
      sessionGroups: SessionGroupsClickHouseRepository.create(traceClickHouse),
      eventPayloads: ClickHouseTraceEventPayloadRepository.createResolved({
        resolveClient: traceClickHouse,
      }),
    };
  }
}
