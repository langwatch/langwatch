// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type GovernanceOcsfExportRow,
  OCSF_PUSHED_SOURCE_TYPE,
  SECURITY_LAKE_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { toDate } from "@langwatch/time";
import { z } from "zod";

import { type GovernanceSeatReportRow, seatReportsOf } from "../../rules/ocsf-seat-report.rules.ts";
import {
  governanceOcsfExportRowOf,
  OCSF_STORED_SCHEMA_VERSION,
} from "../governance.repositories.ts";
import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventsReader,
  GovernanceOcsfEventWriter,
  GovernanceClickHouseTenantResolver,
} from "../governance.repositories.ts";
import type {
  SecurityLakeCallerRepository,
  SecurityLakeCallerRow,
} from "../security-lake-caller.repository.ts";

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
const TABLE_NAME = "governance_ocsf_events" as const;

/** One Security Lake caller row; ClickHouse sends its UInt64 columns as strings. */
const securityLakeCallerRowSchema = z
  .object({
    Principal: z.string(),
    Models: z.array(z.string()),
    Regions: z.array(z.string()),
    LastCallMs: z.coerce.number().finite(),
    CallCount: z.coerce.number().finite(),
  })
  .transform((row): SecurityLakeCallerRow => ({
    principalArn: row.Principal,
    models: row.Models,
    regions: row.Regions,
    lastCallMs: row.LastCallMs,
    callCount: row.CallCount,
  }));

const securityLakeCallerRowsSchema = z.array(securityLakeCallerRowSchema);

const securityLakeEventCountRowsSchema = z.array(z.object({ Events: z.coerce.number().finite() }));

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

/** The licence-seat read `governanceCost.service.ts`'s seats screen needs. */
export interface OcsfSeatReportReader {
  findLatestSeatReports(input: {
    tenantId: string;
    actionName: string;
  }): Promise<GovernanceSeatReportRow[]>;
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
  const { classUid, categoryUid, typeUid } = governanceOcsfExportRowOf(row);
  return {
    TenantId: row.tenantId,
    OcsfSchemaVersion: OCSF_STORED_SCHEMA_VERSION,
    EventId: row.eventId,
    TraceId: row.traceId,
    SourceId: row.sourceId,
    SourceType: row.sourceType,
    ClassUid: classUid,
    CategoryUid: categoryUid,
    ActivityId: row.activityId,
    TypeUid: typeUid,
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
    OcsfIngestOrderedReader,
    SecurityLakeCallerRepository
{
  private constructor(private readonly resolveClient: GovernanceClickHouseTenantResolver) {}

  static create(resolveClient: GovernanceClickHouseTenantResolver): ClickHouseOcsfEventsRepository {
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
    const result = await client.query({
      query: `
        SELECT
          EventId,
          OcsfSchemaVersion,
          TraceId,
          SourceId,
          SourceType,
          ClassUid,
          CategoryUid,
          ActivityId,
          TypeUid,
          SeverityId,
          toString(toUnixTimestamp64Milli(EventTime)) AS EventTimeMs,
          ActorUserId,
          ActorEmail,
          ActorEnduserId,
          ActionName,
          TargetName,
          AnomalyAlertId,
          RawOcsfJson
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND EventTime >= fromUnixTimestamp64Milli({sinceMs:UInt64})
          AND (EventTime, EventId) > (fromUnixTimestamp64Milli({sinceMs:UInt64}), {sinceEventId:String})
          AND (TenantId, EventId, LastUpdatedAt, EventTime) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt), argMax(EventTime, LastUpdatedAt) AS LatestTime
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND EventTime >= fromUnixTimestamp64Milli({sinceMs:UInt64})
              AND (EventTime, EventId) > (fromUnixTimestamp64Milli({sinceMs:UInt64}), {sinceEventId:String})
            GROUP BY TenantId, EventId
            ORDER BY LatestTime ASC, EventId ASC
            LIMIT {limit:UInt32}
          )
        ORDER BY EventTime ASC, EventId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        sinceMs: input.sinceMs,
        sinceEventId: input.sinceEventId,
        limit: input.limit,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as OcsfExportCHRow[];
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
    const filters = [
      input.sinceMs === undefined
        ? ""
        : "AND EventTime >= fromUnixTimestamp64Milli({sinceMs:UInt64})",
      input.untilMs === undefined
        ? ""
        : "AND EventTime < fromUnixTimestamp64Milli({untilMs:UInt64})",
      input.sourceType === undefined ? "" : "AND SourceType = {sourceType:String}",
      input.sourceId === undefined ? "" : "AND SourceId = {sourceId:String}",
    ].join(" ");
    const result = await client.query({
      query: `
        SELECT
          EventId,
          OcsfSchemaVersion,
          TraceId,
          SourceId,
          SourceType,
          ClassUid,
          CategoryUid,
          ActivityId,
          TypeUid,
          SeverityId,
          toString(toUnixTimestamp64Milli(EventTime)) AS EventTimeMs,
          toString(toUnixTimestamp64Milli(LastUpdatedAt)) AS IngestedAtMs,
          ActorUserId,
          ActorEmail,
          ActorEnduserId,
          ActionName,
          TargetName,
          AnomalyAlertId,
          RawOcsfJson
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND LastUpdatedAt >= fromUnixTimestamp64Milli({afterIngestedMs:UInt64})
          ${filters}
          AND (TenantId, EventId, LastUpdatedAt, EventTime) IN (
            SELECT
              TenantId,
              EventId,
              max(LastUpdatedAt) AS Latest,
              argMax(EventTime, LastUpdatedAt) AS LatestTime
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND LastUpdatedAt >= fromUnixTimestamp64Milli({afterIngestedMs:UInt64})
              ${filters}
            GROUP BY TenantId, EventId
            HAVING (Latest, EventId) > (fromUnixTimestamp64Milli({afterIngestedMs:UInt64}), {afterEventId:String})
            ORDER BY Latest ASC, EventId ASC
            LIMIT {limit:UInt32}
          )
        ORDER BY LastUpdatedAt ASC, EventId ASC
        LIMIT 1 BY EventId
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        afterIngestedMs: input.afterIngestedMs,
        afterEventId: input.afterEventId,
        limit: input.limit,
        ...(input.sinceMs === undefined ? {} : { sinceMs: input.sinceMs }),
        ...(input.untilMs === undefined ? {} : { untilMs: input.untilMs }),
        ...(input.sourceType === undefined ? {} : { sourceType: input.sourceType }),
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as (OcsfExportCHRow & { IngestedAtMs: string })[];
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
    const result = await client.query({
      query: `
        SELECT
          SourceId,
          TargetName                                      AS SkuPartNumber,
          toDate(max(EventTime))                          AS Day,
          argMax(RawOcsfJson, (EventTime, LastUpdatedAt)) AS LatestRawOcsfJson
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND ActionName = {actionName:String}
          AND SourceType NOT IN ({pushedSourceType:String}, {securityLakeSourceType:String})
        GROUP BY SourceId, TargetName
        ORDER BY SourceId, TargetName
      `,
      query_params: {
        tenantId: input.tenantId,
        actionName: input.actionName,
        pushedSourceType: OCSF_PUSHED_SOURCE_TYPE,
        securityLakeSourceType: SECURITY_LAKE_SOURCE_TYPE,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as {
      SourceId: string;
      SkuPartNumber: string;
      Day: string;
      LatestRawOcsfJson: string;
    }[];
    return rows.flatMap((row) =>
      seatReportsOf({
        sourceId: String(row.SourceId ?? ""),
        skuPartNumber: String(row.SkuPartNumber ?? ""),
        day: String(row.Day ?? ""),
        rawOcsfJson: String(row.LatestRawOcsfJson ?? ""),
      }),
    );
  }

  /** Security Lake callers grouped by role ARN (the session issuer), else the user uid. */
  async findSecurityLakeCallers(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<SecurityLakeCallerRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Principal,
          arrayFilter(x -> x != '', groupUniqArray(16)(TargetName)) AS Models,
          arrayFilter(x -> x != '', groupUniqArray(16)(Region))     AS Regions,
          max(toUnixTimestamp64Milli(EventTime))                     AS LastCallMs,
          uniqExact(EventId)                                         AS CallCount
        FROM (
          SELECT
            EventId,
            EventTime,
            TargetName,
            if(
              JSONExtractString(RawOcsfJson, 'actor', 'session', 'issuer') != '',
              JSONExtractString(RawOcsfJson, 'actor', 'session', 'issuer'),
              JSONExtractString(RawOcsfJson, 'actor', 'user', 'uid')
            ) AS Principal,
            JSONExtractString(RawOcsfJson, 'cloud', 'region') AS Region
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND SourceType = {sourceType:String}
            AND EventTime >= fromUnixTimestamp64Milli({sinceMs:UInt64})
        )
        WHERE Principal != ''
        GROUP BY Principal
        ORDER BY LastCallMs DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        sourceType: SECURITY_LAKE_SOURCE_TYPE,
        sinceMs: input.sinceMs,
        limit: input.limit,
      },
      format: "JSONEachRow",
    });
    return securityLakeCallerRowsSchema.parse(await result.json());
  }

  async countSecurityLakeEvents(input: { tenantId: string; sourceId: string }): Promise<number> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT uniqExact(EventId) AS Events
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND SourceType = {sourceType:String}
          AND SourceId = {sourceId:String}
      `,
      query_params: {
        tenantId: input.tenantId,
        sourceType: SECURITY_LAKE_SOURCE_TYPE,
        sourceId: input.sourceId,
      },
      format: "JSONEachRow",
    });
    const [row] = securityLakeEventCountRowsSchema.parse(await result.json());
    return row?.Events ?? 0;
  }
}
