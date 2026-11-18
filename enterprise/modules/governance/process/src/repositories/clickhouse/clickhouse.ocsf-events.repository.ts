// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { clickhouseRead, cond, fn, param, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  type GovernanceOcsfExportRow,
  OCSF_PUSHED_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { toDate } from "@langwatch/time";

import { type GovernanceSeatReportRow, seatReportsOf } from "../../rules/ocsf-seat-report.rules.ts";
import { OCSF_STORED_SCHEMA_VERSION } from "../governance.repositories.ts";
import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventsReader,
  GovernanceOcsfEventWriter,
  GovernanceClickHouseReadResolver,
} from "../governance.repositories.ts";
import { governanceOcsfEvents as events } from "./clickhouse.governance-ocsf-events.table.ts";

/**
 * ClickHouseOcsfEventsRepository — read and write side of the
 * `governance_ocsf_events` fold projection. Each insert writes ONE
 * OCSF row keyed by (TenantId, EventId) so subscriber replays of the
 * same event collapse at merge time.
 *
 * Read side is the SIEM export tRPC procedure (3f) which cursor-
 * paginates by EventTime. The OCSF v1.1 / OWASP AOS row shape is
 * what every major SIEM (Splunk / Datadog Cloud SIEM / Sentinel /
 * AWS Security Hub / Elastic Security / Sumo Logic CSE / Google
 * Chronicle) ingests natively.
 *
 * Spec: specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 *       + specs/ai-gateway/governance/siem-export.feature
 * Migration: 00023_create_governance_ocsf_events.sql
 */
const TABLE_NAME = events.$table.name;

/**
 * Rows per INSERT. A run's kept events arrive as one array and each carries
 * its whole raw payload, so an unchunked page has no upper bound on size.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Wait for the async-insert flush: a rejected flush must reach the caller as
 * an error, not vanish after the insert has already returned.
 */
const INSERT_SETTINGS = { async_insert: 1, wait_for_async_insert: 1 } as const;

const logger = createLogger("langwatch:governance:clickhouse-ocsf-events-repository");

const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;

/** Cursor-paginated read of `governance_ocsf_events`, ordered EventTime ASC. */
export interface FindOcsfEventsInput {
  tenantId: string;
  /** Lower bound paired with sinceEventId — returns events after this watermark. */
  sinceMs: number;
  /** EventId watermark paired with sinceMs; disambiguates same-millisecond rows. */
  sinceEventId: string;
  limit: number;
}

/**
 * The batch half of {@link GovernanceOcsfEventWriter}: not itself an app-
 * declared member, but every pull worker writes many events per run and
 * `insertEvent` in a loop is the 150-INSERT regression #8064 fixed.
 */
export interface OcsfEventBatchWriter {
  insertEvents(rows: GovernanceOcsfEvent[]): Promise<void>;
}

/** An export row with the time ClickHouse stored it, which is what the SIEM cursor pages by. */
export type GovernanceOcsfIngestOrderedRow = GovernanceOcsfExportRow & { ingestedAtMs: number };

/** Events stored after an (ingest time, EventId) watermark, so a back-dated event is still read. */
export interface FindOcsfEventsByIngestInput {
  tenantId: string;
  afterIngestedMs: number;
  afterEventId: string;
  limit: number;
  /** Inclusive lower bound on EventTime. */
  sinceMs?: number;
  /** Exclusive upper bound on EventTime. */
  untilMs?: number;
  sourceType?: string;
  sourceId?: string;
}

export interface OcsfIngestOrderedReader {
  findAllByIngest(input: FindOcsfEventsByIngestInput): Promise<GovernanceOcsfIngestOrderedRow[]>;
}

export type { GovernanceSeatReportRow };

/** The licence-seat read `governanceCost.service.ts`'s seats screen needs. */
export interface OcsfSeatReportReader {
  findLatestSeatReports(input: {
    tenantId: string;
    actionName: string;
  }): Promise<GovernanceSeatReportRow[]>;
}

/** The export row's columns, as both SIEM reads select them. */
const EXPORT_COLUMNS = {
  EventId: events.EventId,
  OcsfSchemaVersion: events.OcsfSchemaVersion,
  TraceId: events.TraceId,
  SourceId: events.SourceId,
  SourceType: events.SourceType,
  ClassUid: events.ClassUid,
  CategoryUid: events.CategoryUid,
  ActivityId: events.ActivityId,
  TypeUid: events.TypeUid,
  SeverityId: events.SeverityId,
  EventTimeMs: fn.toString(fn.toUnixTimestamp64Milli(events.EventTime)),
  ActorUserId: events.ActorUserId,
  ActorEmail: events.ActorEmail,
  ActorEnduserId: events.ActorEnduserId,
  ActionName: events.ActionName,
  TargetName: events.TargetName,
  AnomalyAlertId: events.AnomalyAlertId,
  RawOcsfJson: events.RawOcsfJson,
};

/**
 * A page's election: each key's latest version, carrying that version's EventTime so the outer,
 * payload-reading scan prunes to the page's months. The caller orders and caps it to the page.
 */
const ELECTED_VERSION = {
  TenantId: events.TenantId,
  EventId: events.EventId,
  Latest: fn.max(events.LastUpdatedAt),
  LatestTime: fn.argMax(events.EventTime, events.LastUpdatedAt),
};

/** Past the export cursor; the plain `EventTime >=` prunes partitions, the tuple alone none. */
function exportPageAfter(input: FindOcsfEventsInput) {
  return [
    cond.gte(events.EventTime, input.sinceMs),
    cond.gt(
      fn.tuple(events.EventTime, events.EventId),
      fn.tuple(param.epochMs(input.sinceMs), param.string(input.sinceEventId)),
    ),
  ] as const;
}

/** Versions stored from the stream's watermark on, inside its optional time and source filters. */
function storedFromWatermark(input: FindOcsfEventsByIngestInput) {
  return [
    cond.gte(events.LastUpdatedAt, input.afterIngestedMs),
    ...(input.sinceMs === undefined ? [] : [cond.gte(events.EventTime, input.sinceMs)]),
    ...(input.untilMs === undefined ? [] : [cond.lt(events.EventTime, input.untilMs)]),
    ...(input.sourceType === undefined ? [] : [cond.eq(events.SourceType, input.sourceType)]),
    ...(input.sourceId === undefined ? [] : [cond.eq(events.SourceId, input.sourceId)]),
  ];
}

interface OcsfExportCHRow {
  EventId: string;
  OcsfSchemaVersion: string;
  TraceId: string;
  SourceId: string;
  SourceType: string;
  ClassUid: number | string;
  CategoryUid: number | string;
  ActivityId: number | string;
  TypeUid: number | string;
  SeverityId: number | string;
  EventTimeMs: string;
  ActorUserId: string;
  ActorEmail: string;
  ActorEnduserId: string;
  ActionName: string;
  TargetName: string;
  AnomalyAlertId: string;
  RawOcsfJson: string;
}

function toExportRow(r: OcsfExportCHRow): GovernanceOcsfExportRow {
  return {
    eventId: r.EventId,
    ocsfSchemaVersion: r.OcsfSchemaVersion,
    traceId: r.TraceId,
    sourceId: r.SourceId,
    sourceType: r.SourceType,
    classUid: Number(r.ClassUid),
    categoryUid: Number(r.CategoryUid),
    activityId: Number(r.ActivityId),
    typeUid: Number(r.TypeUid),
    severityId: Number(r.SeverityId),
    eventTimeMs: Number(r.EventTimeMs),
    actorUserId: r.ActorUserId,
    actorEmail: r.ActorEmail,
    actorEnduserId: r.ActorEnduserId,
    actionName: r.ActionName,
    targetName: r.TargetName,
    anomalyAlertId: r.AnomalyAlertId,
    rawOcsfJson: r.RawOcsfJson,
  };
}

function toOcsfEventValues(row: GovernanceOcsfEvent): Record<string, unknown> {
  return {
    TenantId: row.tenantId,
    OcsfSchemaVersion: OCSF_STORED_SCHEMA_VERSION,
    EventId: row.eventId,
    TraceId: row.traceId,
    SourceId: row.sourceId,
    SourceType: row.sourceType,
    ClassUid: row.classUid ?? OCSF_CLASS_API_ACTIVITY,
    CategoryUid: row.categoryUid ?? OCSF_CATEGORY_APPLICATION_ACTIVITY,
    ActivityId: row.activityId,
    TypeUid: row.typeUid ?? (row.classUid ?? OCSF_CLASS_API_ACTIVITY) * 100 + row.activityId,
    SeverityId: row.severityId,
    // `eventTime` is a Temporal Instant on this branch; the client wants a Date.
    EventTime: toDate(row.eventTime),
    ActorUserId: row.actorUserId,
    ActorEmail: row.actorEmail,
    ActorEnduserId: row.actorEnduserId,
    ActionName: row.actionName,
    TargetName: row.targetName,
    AnomalyAlertId: row.anomalyAlertId,
    RawOcsfJson: row.rawOcsfJson,
  };
}

export class ClickHouseOcsfEventsRepository
  implements
    GovernanceOcsfEventsReader,
    GovernanceOcsfEventWriter,
    OcsfEventBatchWriter,
    OcsfSeatReportReader,
    OcsfIngestOrderedReader
{
  private constructor(private readonly resolveClient: GovernanceClickHouseReadResolver) {}

  static create(resolveClient: GovernanceClickHouseReadResolver): ClickHouseOcsfEventsRepository {
    return new ClickHouseOcsfEventsRepository(resolveClient);
  }

  async insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    await this.insertEvents([row]);
  }

  /**
   * One INSERT per chunk of rows, awaited in turn. The old loop awaited one
   * INSERT per row — one statement at a time, but ~150 of them removed from a
   * pull that issues ~2,600 against a dev server budgeted at 32 (#8064).
   * Every row must belong to the same tenant: the client is resolved once,
   * for that tenant, and a mixed page is refused rather than split.
   */
  async insertEvents(rows: GovernanceOcsfEvent[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) {
      if (!row.tenantId || !row.eventId) {
        throw new Error(
          "ClickHouseOcsfEventsRepository.insertEvents: tenantId / eventId are required",
        );
      }
    }
    const tenantId = rows[0]!.tenantId;
    if (rows.some((row) => row.tenantId !== tenantId)) {
      throw new Error(
        "ClickHouseOcsfEventsRepository.insertEvents: every row must belong to the same tenant",
      );
    }
    try {
      const client = await this.resolveClient(tenantId);
      for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
        await client.insert({
          table: TABLE_NAME,
          values: rows.slice(start, start + INSERT_CHUNK_SIZE).map(toOcsfEventValues),
          format: "JSONEachRow",
          clickhouse_settings: INSERT_SETTINGS,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId,
          rowCount: rows.length,
          firstEventId: rows[0]!.eventId,
          firstTraceId: rows[0]!.traceId,
          error: errorMessage,
        },
        "Failed to insert governance_ocsf_events rows",
      );
      throw error;
    }
  }

  /**
   * SIEM forwarding pull: the latest version of each (TenantId, EventId), EventTime ASC.
   * The plain `EventTime >=` prunes partitions (the tuple cursor alone prunes none) and
   * implies nothing the tuple does not. The dedup set holds the page's keys only, and each
   * key's EventTime prunes the payload read to the page's months.
   * Spec: enterprise/modules/governance/specs/ocsf-event-pages.feature
   */
  async findAll(input: FindOcsfEventsInput): Promise<GovernanceOcsfExportRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(events)
      .select(EXPORT_COLUMNS)
      .where(({ and, within }) =>
        and(
          ...exportPageAfter(input),
          within(
            fn.tuple(events.TenantId, events.EventId, events.LastUpdatedAt, events.EventTime),
            (sub) =>
              sub
                .from(events)
                .select(ELECTED_VERSION)
                .where(({ and }) => and(...exportPageAfter(input)))
                .groupBy(events.TenantId, events.EventId)
                .orderBy("LatestTime", "ASC")
                .orderBy(events.EventId, "ASC")
                .limit(input.limit),
          ),
        ),
      )
      .orderBy(events.EventTime, "ASC")
      .orderBy(events.EventId, "ASC")
      .limit(input.limit)
      .build();
    const { rows } = await client.read({ statement });
    return rows.map(toExportRow);
  }

  /**
   * The SIEM stream: the latest version of each event, ordered by the time it was stored (paging
   * by EventTime would skip a back-dated event); only versions from the watermark on are grouped.
   * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
   */
  async findAllByIngest(
    input: FindOcsfEventsByIngestInput,
  ): Promise<GovernanceOcsfIngestOrderedRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(events)
      .select({
        ...EXPORT_COLUMNS,
        IngestedAtMs: fn.toString(fn.toUnixTimestamp64Milli(events.LastUpdatedAt)),
      })
      .where(({ and, within }) =>
        and(
          ...storedFromWatermark(input),
          within(
            fn.tuple(events.TenantId, events.EventId, events.LastUpdatedAt, events.EventTime),
            (sub) =>
              sub
                .from(events)
                .select(ELECTED_VERSION)
                .where(({ and }) => and(...storedFromWatermark(input)))
                .groupBy(events.TenantId, events.EventId)
                .having(({ gt }) =>
                  gt(
                    fn.tuple(fn.max(events.LastUpdatedAt), events.EventId),
                    fn.tuple(
                      param.epochMs(input.afterIngestedMs),
                      param.string(input.afterEventId),
                    ),
                  ),
                )
                .orderBy("Latest", "ASC")
                .orderBy(events.EventId, "ASC")
                .limit(input.limit),
          ),
        ),
      )
      .orderBy(events.LastUpdatedAt, "ASC")
      .orderBy(events.EventId, "ASC")
      .limitBy(1, events.EventId)
      .limit(input.limit)
      .build();
    const { rows } = await client.read({ statement });
    return rows.map((r) => ({ ...toExportRow(r), ingestedAtMs: Number(r.IngestedAtMs) }));
  }

  /**
   * The newest seat report each licence pool carries.
   *
   * One row per pool rather than per day: a licence count is a standing fact,
   * and what the screen asks is what the tenant holds now. So the newest
   * report of a pool REPLACES the older ones instead of adding to them —
   * summing a pool's days would multiply the tenant's seats by however many
   * times the licence list happened to be read.
   *
   * `argMax` over `(EventTime, LastUpdatedAt)` rather than `EventTime` alone,
   * because both are in play: EventTime picks the newest DAY, and a re-read of
   * that same day writes a second version of the same row, which only
   * LastUpdatedAt separates. Ordering on the day alone would leave that tie to
   * whichever version the merge had not collapsed yet, so the same query would
   * answer differently before and after a merge.
   *
   * Events pushed in from another source (`ocsf_push`) never count: a seat figure is
   * LangWatch's own read of the provider. TenantId leads the predicate — nothing else here is unique across tenants
   * — and `ActionName` narrows to seat reports, so no conversation reaches the
   * decode.
   */
  async findLatestSeatReports(input: {
    tenantId: string;
    actionName: string;
  }): Promise<GovernanceSeatReportRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(events)
      .select({
        SourceId: events.SourceId,
        SkuPartNumber: events.TargetName,
        Day: fn.toDate(fn.max(events.EventTime)),
        LatestRawOcsfJson: fn.argMax(
          events.RawOcsfJson,
          fn.tuple(events.EventTime, events.LastUpdatedAt),
        ),
      })
      .where(({ and, eq, ne }) =>
        and(
          eq(events.ActionName, input.actionName),
          ne(events.SourceType, OCSF_PUSHED_SOURCE_TYPE),
        ),
      )
      .groupBy(events.SourceId, events.TargetName)
      .orderBy(events.SourceId, "ASC")
      .orderBy(events.TargetName, "ASC")
      .build();
    const { rows } = await client.read({ statement });
    return rows.flatMap((row) =>
      seatReportsOf({
        sourceId: row.SourceId,
        skuPartNumber: row.SkuPartNumber,
        day: String(row.Day),
        rawOcsfJson: row.LatestRawOcsfJson,
      }),
    );
  }
}
