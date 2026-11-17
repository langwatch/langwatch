import {
  type GovernanceOcsfExportRow,
  OCSF_PUSHED_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";

import {
  ClickHouseOcsfEventsRepository,
  type FindOcsfEventsByIngestInput,
  type FindOcsfEventsInput,
  type GovernanceOcsfIngestOrderedRow,
  type GovernanceSeatReportRow,
  type OcsfEventBatchWriter,
  type OcsfIngestOrderedReader,
  type OcsfSeatReportReader,
} from "../clickhouse/clickhouse.ocsf-events.repository.ts";
import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventsReader,
  GovernanceOcsfEventWriter,
} from "../governance.repositories.ts";

/**
 * The OCSF-events twin: the newest write per (tenantId, eventId) wins, same
 * as the live table's ReplacingMergeTree collapse.
 */
export class MemoryOcsfEventsRepository
  implements
    GovernanceOcsfEventsReader,
    GovernanceOcsfEventWriter,
    OcsfEventBatchWriter,
    OcsfSeatReportReader,
    OcsfIngestOrderedReader
{
  private readonly eventsByKey = new Map<string, GovernanceOcsfEvent>();
  private readonly ingestedAtByKey = new Map<string, number>();
  private lastIngestedAtMs = 0;

  static create(): MemoryOcsfEventsRepository {
    return new MemoryOcsfEventsRepository();
  }

  async insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    await this.insertEvents([row]);
  }

  async insertEvents(rows: GovernanceOcsfEvent[]): Promise<void> {
    // A strictly later stamp per batch stands in for the live table's LastUpdatedAt.
    this.lastIngestedAtMs = Math.max(nowInstant().epochMilliseconds, this.lastIngestedAtMs + 1);
    for (const row of rows) {
      const key = `${row.tenantId}:${row.eventId}`;
      this.eventsByKey.set(key, row);
      this.ingestedAtByKey.set(key, this.lastIngestedAtMs);
    }
  }

  async findAll(input: FindOcsfEventsInput): Promise<GovernanceOcsfExportRow[]> {
    return [...this.eventsByKey.values()]
      .filter((row) => row.tenantId === input.tenantId)
      .filter(
        (row) => input.untilMs === undefined || row.eventTime.epochMilliseconds < input.untilMs,
      )
      .filter((row) => input.sourceType === undefined || row.sourceType === input.sourceType)
      .filter((row) => input.sourceId === undefined || row.sourceId === input.sourceId)
      .filter(
        (row) =>
          row.eventTime.epochMilliseconds > input.sinceMs ||
          (row.eventTime.epochMilliseconds === input.sinceMs && row.eventId > input.sinceEventId),
      )
      .toSorted((a, b) => {
        const byTime = a.eventTime.epochMilliseconds - b.eventTime.epochMilliseconds;
        return byTime !== 0 ? byTime : a.eventId.localeCompare(b.eventId);
      })
      .slice(0, input.limit)
      .map(toExportRow);
  }

  async findAllByIngest(
    input: FindOcsfEventsByIngestInput,
  ): Promise<GovernanceOcsfIngestOrderedRow[]> {
    const ingestedAt = (row: GovernanceOcsfEvent) =>
      this.ingestedAtByKey.get(`${row.tenantId}:${row.eventId}`) ?? 0;
    return [...this.eventsByKey.values()]
      .filter((row) => row.tenantId === input.tenantId)
      .filter(
        (row) => input.sinceMs === undefined || row.eventTime.epochMilliseconds >= input.sinceMs,
      )
      .filter(
        (row) => input.untilMs === undefined || row.eventTime.epochMilliseconds < input.untilMs,
      )
      .filter((row) => input.sourceType === undefined || row.sourceType === input.sourceType)
      .filter((row) => input.sourceId === undefined || row.sourceId === input.sourceId)
      .filter(
        (row) =>
          ingestedAt(row) > input.afterIngestedMs ||
          (ingestedAt(row) === input.afterIngestedMs && row.eventId > input.afterEventId),
      )
      .toSorted((a, b) => ingestedAt(a) - ingestedAt(b) || a.eventId.localeCompare(b.eventId))
      .slice(0, input.limit)
      .map((row) => ({ ...toExportRow(row), ingestedAtMs: ingestedAt(row) }));
  }

  /** The newest seat report per pool, from LangWatch's own events only, as the live read. */
  async findLatestSeatReports(input: {
    tenantId: string;
    actionName: string;
  }): Promise<GovernanceSeatReportRow[]> {
    const latest = new Map<string, GovernanceOcsfEvent>();
    for (const row of this.eventsByKey.values()) {
      if (row.tenantId !== input.tenantId || row.actionName !== input.actionName) continue;
      if (row.sourceType === OCSF_PUSHED_SOURCE_TYPE) continue;
      const pool = `${row.sourceId}:${row.targetName}`;
      const held = latest.get(pool);
      if (!held || held.eventTime.epochMilliseconds <= row.eventTime.epochMilliseconds) {
        latest.set(pool, row);
      }
    }
    return [...latest.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .flatMap(([, row]) =>
        ClickHouseOcsfEventsRepository.seatReportsOf({
          SourceId: row.sourceId,
          SkuPartNumber: row.targetName,
          Day: row.eventTime.toString().slice(0, 10),
          LatestRawOcsfJson: row.rawOcsfJson,
        }),
      );
  }
}

function toExportRow(row: GovernanceOcsfEvent): GovernanceOcsfExportRow {
  return {
    eventId: row.eventId,
    ocsfSchemaVersion: "1.1.0",
    traceId: row.traceId,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    classUid: row.classUid ?? 6003,
    categoryUid: row.categoryUid ?? 6,
    activityId: row.activityId,
    typeUid: row.typeUid ?? (row.classUid ?? 6003) * 100 + row.activityId,
    severityId: row.severityId,
    eventTimeMs: row.eventTime.epochMilliseconds,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorEnduserId: row.actorEnduserId,
    actionName: row.actionName,
    targetName: row.targetName,
    anomalyAlertId: row.anomalyAlertId,
    rawOcsfJson: row.rawOcsfJson,
  };
}
