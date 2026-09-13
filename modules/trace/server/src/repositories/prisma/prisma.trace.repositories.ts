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
 * The live tier. The tier is named for the store every row the module
 * keeps outside ClickHouse lives in; the three projections need the
 * tenant-keyed ClickHouse connection as well, so both are required inputs of
 * the one tier.
 *
 * The retention fallback is RESOLVED here rather than claimed as a member.
 * `requires` may only name the fourteen keys of `ProcessMembers` — a tier's
 * requires list is fed to `buildClaimedMembers`, which walks the process's
 * member order and refuses any name it cannot find — so
 * `"defaultRetentionDays"` could never be satisfied by any process and stopped
 * the api booting. It is a leftover from when a hand-written composition called
 * `traceRepositories.definitions.postgres.create({...})` directly with its own
 * arguments (`api-trace-read-stack.composition.ts:529`, deleted by b383462d96);
 * once `withModules` began resolving these against members, the entry became
 * unsatisfiable.
 *
 * `resolvePlatformDefaultRetentionDays` is the one function every process must
 * use for this: "Both processes stamp rows in one ClickHouse, so both read this
 * one way: a process that resolved a different default would expire the other's
 * rows" (data-retention.config.ts). Calling it here reads the same environment
 * through the same rule the api's own config does, so the two cannot disagree —
 * which a module-local constant would not guarantee.
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
