// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type GovernanceOcsfExportRow,
  OCSF_PUSHED_SOURCE_TYPE,
  SECURITY_LAKE_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import { nowInstant } from "@langwatch/time";

import { type GovernanceSeatReportRow, seatReportsOf } from "../../rules/ocsf-seat-report.rules.ts";
import type {
  FindOcsfEventsByIngestInput,
  FindOcsfEventsInput,
  GovernanceOcsfIngestOrderedRow,
  OcsfEventBatchWriter,
  OcsfIngestOrderedReader,
  OcsfSeatReportReader,
} from "../clickhouse/clickhouse.ocsf-events.repository.ts";
import {
  governanceOcsfExportRowOf,
  type GovernanceOcsfEvent,
  type GovernanceOcsfEventsReader,
  type GovernanceOcsfEventWriter,
} from "../governance.repositories.ts";
import type {
  SecurityLakeCallerRepository,
  SecurityLakeCallerRow,
} from "../security-lake-caller.repository.ts";

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
    OcsfIngestOrderedReader,
    SecurityLakeCallerRepository
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
        (row) =>
          row.eventTime.epochMilliseconds > input.sinceMs ||
          (row.eventTime.epochMilliseconds === input.sinceMs && row.eventId > input.sinceEventId),
      )
      .toSorted((a, b) => {
        const byTime = a.eventTime.epochMilliseconds - b.eventTime.epochMilliseconds;
        return byTime !== 0 ? byTime : a.eventId.localeCompare(b.eventId);
      })
      .slice(0, input.limit)
      .map(governanceOcsfExportRowOf);
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
      .map((row) => ({ ...governanceOcsfExportRowOf(row), ingestedAtMs: ingestedAt(row) }));
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
      if (row.sourceType === SECURITY_LAKE_SOURCE_TYPE) continue;
      const pool = `${row.sourceId}:${row.targetName}`;
      const held = latest.get(pool);
      if (!held || held.eventTime.epochMilliseconds <= row.eventTime.epochMilliseconds) {
        latest.set(pool, row);
      }
    }
    return [...latest.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .flatMap(([, row]) =>
        seatReportsOf({
          sourceId: row.sourceId,
          skuPartNumber: row.targetName,
          day: row.eventTime.toString().slice(0, 10),
          rawOcsfJson: row.rawOcsfJson,
        }),
      );
  }

  async countSecurityLakeEvents(input: { tenantId: string; sourceId: string }): Promise<number> {
    return [...this.eventsByKey.values()].filter(
      (row) =>
        row.tenantId === input.tenantId &&
        row.sourceType === SECURITY_LAKE_SOURCE_TYPE &&
        row.sourceId === input.sourceId,
    ).length;
  }

  async findSecurityLakeCallers(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<SecurityLakeCallerRow[]> {
    const byPrincipal = new Map<string, SecurityLakeCallerRow>();
    for (const row of this.eventsByKey.values()) {
      if (row.tenantId !== input.tenantId || row.sourceType !== SECURITY_LAKE_SOURCE_TYPE) continue;
      if (row.eventTime.epochMilliseconds < input.sinceMs) continue;
      const raw = JSON.parse(row.rawOcsfJson) as {
        actor?: { session?: { issuer?: string }; user?: { uid?: string } };
        cloud?: { region?: string };
      };
      const principalArn = raw.actor?.session?.issuer || raw.actor?.user?.uid || "";
      if (!principalArn) continue;
      const caller = byPrincipal.get(principalArn) ?? {
        principalArn,
        models: [],
        regions: [],
        lastCallMs: 0,
        callCount: 0,
      };
      if (row.targetName && !caller.models.includes(row.targetName))
        caller.models.push(row.targetName);
      const region = raw.cloud?.region ?? "";
      if (region && !caller.regions.includes(region)) caller.regions.push(region);
      caller.lastCallMs = Math.max(caller.lastCallMs, row.eventTime.epochMilliseconds);
      caller.callCount += 1;
      byPrincipal.set(principalArn, caller);
    }
    return [...byPrincipal.values()]
      .toSorted((a, b) => b.lastCallMs - a.lastCallMs)
      .slice(0, input.limit);
  }
}
