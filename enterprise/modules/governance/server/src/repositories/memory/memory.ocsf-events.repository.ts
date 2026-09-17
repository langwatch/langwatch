// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";
import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventsReader,
  GovernanceOcsfEventWriter,
} from "../../app/governance.members.ts";
import type {
  FindOcsfEventsInput,
  GovernanceSeatReportRow,
  OcsfEventBatchWriter,
  OcsfSeatReportReader,
} from "../clickhouse/clickhouse.ocsf-events.repository.ts";

/**
 * The OCSF-events twin: the newest write per (tenantId, eventId) wins, same
 * as the live table's ReplacingMergeTree collapse.
 */
export class MemoryOcsfEventsRepository
  implements
    GovernanceOcsfEventsReader,
    GovernanceOcsfEventWriter,
    OcsfEventBatchWriter,
    OcsfSeatReportReader
{
  private readonly eventsByKey = new Map<string, GovernanceOcsfEvent>();

  static create(): MemoryOcsfEventsRepository {
    return new MemoryOcsfEventsRepository();
  }

  async insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    await this.insertEvents([row]);
  }

  async insertEvents(rows: GovernanceOcsfEvent[]): Promise<void> {
    for (const row of rows) {
      this.eventsByKey.set(`${row.tenantId}:${row.eventId}`, row);
    }
  }

  async findAll(input: FindOcsfEventsInput): Promise<GovernanceOcsfExportRow[]> {
    const rows = [...this.eventsByKey.values()]
      .filter((row) => row.tenantId === input.tenantId)
      .filter(
        (row) =>
          row.eventTime.epochMilliseconds > input.sinceMs ||
          (row.eventTime.epochMilliseconds === input.sinceMs && row.eventId > input.sinceEventId),
      )
      .toSorted((a, b) => {
        const byTime = a.eventTime.epochMilliseconds - b.eventTime.epochMilliseconds;
        return byTime !== 0 ? byTime : a.eventId.localeCompare(b.eventId);
      })
      .slice(0, input.limit);

    return rows.map((row) => ({
      eventId: row.eventId,
      ocsfSchemaVersion: "1.1.0",
      traceId: row.traceId,
      sourceId: row.sourceId,
      sourceType: row.sourceType,
      classUid: 6003,
      categoryUid: 6,
      activityId: row.activityId,
      typeUid: 6003 * 100 + row.activityId,
      severityId: row.severityId,
      eventTimeMs: row.eventTime.epochMilliseconds,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      actorEnduserId: row.actorEnduserId,
      actionName: row.actionName,
      targetName: row.targetName,
      anomalyAlertId: row.anomalyAlertId,
      rawOcsfJson: row.rawOcsfJson,
    }));
  }

  async findLatestSeatReports(input: {
    tenantId: string;
    actionName: string;
  }): Promise<GovernanceSeatReportRow[]> {
    // The memory twin has never carried seat-report data: nothing seeds a
    // seat_report action here, and inventing seats nobody bought would be
    // worse than answering an honest empty list.
    void input;
    return [];
  }
}
