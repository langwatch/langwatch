// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
/**
 * GovernanceOcsfEventsClickHouseRepository — write side of the
 * `governance_ocsf_events` fold projection. Each call inserts ONE
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
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

const TABLE_NAME = "governance_ocsf_events" as const;

const logger = createLogger(
  "langwatch:governance:governance-ocsf-events-clickhouse-repository",
);

/**
 * OCSF v1.1 SeverityId values.
 *   1 = Informational
 *   3 = Low (warning)
 *   4 = Medium
 *   5 = High
 *   6 = Critical
 * Per the spec: default 1 (info); elevated when
 * langwatch.governance.anomaly_alert_id is set.
 */
export const OCSF_SEVERITY = {
  INFO: 1,
  LOW: 3,
  MEDIUM: 4,
  HIGH: 5,
  CRITICAL: 6,
} as const;

export type OcsfSeverity = (typeof OCSF_SEVERITY)[keyof typeof OCSF_SEVERITY];

/**
 * OCSF v1.1 ActivityId values for ClassUid 6003 (API Activity).
 *   1 = Create
 *   2 = Read
 *   3 = Update
 *   4 = Delete
 *   6 = Invoke (LLM call / agent action)
 */
export const OCSF_ACTIVITY = {
  CREATE: 1,
  READ: 2,
  UPDATE: 3,
  DELETE: 4,
  INVOKE: 6,
} as const;

export type OcsfActivity = (typeof OCSF_ACTIVITY)[keyof typeof OCSF_ACTIVITY];

const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;

/**
 * Single source of truth for the OCSF schema version stamped on every
 * row written to governance_ocsf_events. SIEM consumers filter on this
 * to opt into / out of new OCSF revisions. Bump in lockstep with the
 * `RawOcsfJson` payload shape; downstream OCSF v1.2 work would update
 * this constant + (optionally) emit a new ClassUid.
 *
 * Migration: 00028_add_ocsf_schema_version.sql
 */
export const OCSF_SCHEMA_VERSION = "1.1.0" as const;

export interface GovernanceOcsfEventInput {
  tenantId: string;
  eventId: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  activityId: OcsfActivity;
  severityId: OcsfSeverity;
  eventTime: Date;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
}

/** Cursor-paginated read of `governance_ocsf_events`, ordered EventTime ASC. */
export interface FindOcsfEventsInput {
  tenantId: string;
  /** Lower bound paired with sinceEventId — returns events after this watermark. */
  sinceMs: number;
  /** EventId watermark paired with sinceMs; disambiguates same-millisecond rows. */
  sinceEventId: string;
  limit: number;
}

export interface GovernanceOcsfExportRow {
  eventId: string;
  /**
   * Forward-compat marker stamped at write time by
   * {@link OCSF_SCHEMA_VERSION}. Pre-this-column rows decode as "1.1.0" via
   * the CH DEFAULT (migration 00028). SIEM consumers can filter or
   * version-gate downstream parsing on this value.
   */
  ocsfSchemaVersion: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  classUid: number;
  categoryUid: number;
  activityId: number;
  typeUid: number;
  severityId: number;
  eventTimeMs: number;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
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

export class GovernanceOcsfEventsClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertEvent(row: GovernanceOcsfEventInput): Promise<void> {
    if (!row.tenantId || !row.eventId) {
      throw new Error(
        "GovernanceOcsfEventsClickHouseRepository.insertEvent: tenantId / eventId are required",
      );
    }
    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [
          {
            TenantId: row.tenantId,
            OcsfSchemaVersion: OCSF_SCHEMA_VERSION,
            EventId: row.eventId,
            TraceId: row.traceId,
            SourceId: row.sourceId,
            SourceType: row.sourceType,
            ClassUid: OCSF_CLASS_API_ACTIVITY,
            CategoryUid: OCSF_CATEGORY_APPLICATION_ACTIVITY,
            ActivityId: row.activityId,
            TypeUid: OCSF_CLASS_API_ACTIVITY * 100 + row.activityId,
            SeverityId: row.severityId,
            EventTime: row.eventTime,
            ActorUserId: row.actorUserId,
            ActorEmail: row.actorEmail,
            ActorEnduserId: row.actorEnduserId,
            ActionName: row.actionName,
            TargetName: row.targetName,
            AnomalyAlertId: row.anomalyAlertId,
            RawOcsfJson: row.rawOcsfJson,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: row.tenantId,
          eventId: row.eventId,
          traceId: row.traceId,
          error: errorMessage,
        },
        "Failed to insert governance_ocsf_events row",
      );
      throw error;
    }
  }

  /**
   * SIEM forwarding pull — the read side of `governance_ocsf_events`,
   * deduped to the latest version of each (TenantId, EventId) and ordered
   * EventTime ASC for cursor pagination.
   *
   * Spec: specs/ai-gateway/governance/siem-export.feature
   */
  async findAll(
    input: FindOcsfEventsInput,
  ): Promise<GovernanceOcsfExportRow[]> {
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
          AND (EventTime, EventId) > (fromUnixTimestamp64Milli({sinceMs:UInt64}), {sinceEventId:String})
          AND (TenantId, EventId, LastUpdatedAt) IN (
            SELECT TenantId, EventId, max(LastUpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND (EventTime, EventId) > (fromUnixTimestamp64Milli({sinceMs:UInt64}), {sinceEventId:String})
            GROUP BY TenantId, EventId
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
    return rows.map((r) => ({
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
    }));
  }
}
