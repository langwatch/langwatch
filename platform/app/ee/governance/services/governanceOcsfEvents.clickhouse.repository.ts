// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type ClickHouseClient,
  ch,
  createRowCodec,
  defineTable,
  replacing,
  type TableRow,
} from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
/**
 * GovernanceOcsfEventsClickHouseRepository — write side of the
 * `governance_ocsf_events` map projection. Each call inserts ONE
 * OCSF row keyed by (TenantId, EventId) so re-derivations of the
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
 * Migrations: 00026_create_governance_ocsf_events.sql,
 *             00027_add_ocsf_schema_version.sql (OcsfSchemaVersion)
 */
import { assertSingleTenantBatch } from "./singleTenantBatch";

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
 * Migration: 00027_add_ocsf_schema_version.sql
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

/**
 * `EventTime` carries the `acceptedAt` role — frozen and platform-
 * controlled — even though its value is the span event's own business
 * time. It anchors this table's partition, and the map projection that
 * derives each row is a PURE, TOTAL function of one immutable span, so a
 * given EventId's EventTime never changes between the row's first
 * derivation and any later rebuild (ADR-099; the same pattern
 * `langy-analytics-event.clickhouse.repository.ts` documents for its own
 * `OccurredAt`).
 */
const table = defineTable({
  name: "governance_ocsf_events",
  merge: replacing({ version: "LastUpdatedAt" }),
  sortKey: ["TenantId", "EventId"],
  partition: { by: "toYYYYMM(EventTime)", column: "EventTime" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    OcsfSchemaVersion: ch.lowCardinality(ch.string()),
    EventId: ch.string(),
    TraceId: ch.string(),
    SourceId: ch.string(),
    SourceType: ch.lowCardinality(ch.string()),
    ClassUid: ch.uint32(),
    CategoryUid: ch.uint32(),
    ActivityId: ch.uint8(),
    TypeUid: ch.uint32(),
    SeverityId: ch.uint8(),
    EventTime: ch.acceptedAt(),
    ActorUserId: ch.string(),
    ActorEmail: ch.string(),
    ActorEnduserId: ch.string(),
    ActionName: ch.string(),
    TargetName: ch.string(),
    AnomalyAlertId: ch.string(),
    RawOcsfJson: ch.string(),
    CreatedAt: ch.dateTime64(3),
    LastUpdatedAt: ch.writtenAt(),
  },
});

type Row = TableRow<typeof table.columns>;

const codec = createRowCodec();

/**
 * `CreatedAt` and `LastUpdatedAt` both carry `DEFAULT now64(3)` in the
 * deployed DDL, but the positional wire form has no way to omit a declared
 * column and fall back to a server default, so both take one shared write
 * instant per batch instead. That is a real behaviour change from the
 * legacy repository, which left `LastUpdatedAt` unset so the server clock
 * stamped it at merge time — a re-report or rebuild still supersedes the
 * row it replaces, because `writtenAt` here still moves forward on every
 * write, just from the app's clock rather than the server's.
 */
function toRow(row: GovernanceOcsfEventInput, writtenAt: Date): Row {
  return {
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
    CreatedAt: writtenAt,
    LastUpdatedAt: writtenAt,
  };
}

function assertInsertable(row: GovernanceOcsfEventInput, method: string): void {
  if (!row.tenantId || !row.eventId) {
    throw new Error(
      `GovernanceOcsfEventsClickHouseRepository.${method}: tenantId / eventId are required`,
    );
  }
}

export class GovernanceOcsfEventsClickHouseRepository {
  constructor(
    private readonly resolveClient: (tenantId: string) => ClickHouseClient,
  ) {}

  async insertEvent(row: GovernanceOcsfEventInput): Promise<void> {
    assertInsertable(row, "insertEvent");
    await this.insertRows([row]);
  }

  /**
   * Batch form of {@link insertEvent}, used by the projection's
   * `bulkAppend` so rebuilding an audit window does not issue one INSERT
   * per event.
   *
   * Single-tenant by contract — the projection executor only batches
   * within one tenant, and writing another tenant's audit rows through a
   * tenant's client is exactly the mistake this rejects rather than
   * guesses at.
   */
  async insertEvents(rows: readonly GovernanceOcsfEventInput[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) assertInsertable(row, "insertEvents");
    await this.insertRows(rows);
  }

  private async insertRows(
    rows: readonly GovernanceOcsfEventInput[],
  ): Promise<void> {
    const tenantId = assertSingleTenantBatch(
      rows,
      "GovernanceOcsfEventsClickHouseRepository",
    );

    const writtenAt = new Date();
    const encodedRows = codec.encodeRows({
      columns: table.wireColumns,
      columnNames: table.columnNames,
      rows: rows.map((row) => toRow(row, writtenAt)),
    });

    try {
      const client = this.resolveClient(tenantId);
      await client.insert({
        tenantId,
        table: table.name,
        rows: encodedRows,
        columns: table.columnNames,
        // Retryable: LastUpdatedAt is the replacing version, so a
        // redelivered batch collapses at merge instead of duplicating
        // (ADR-104 §2).
        target: { kind: "replacing" },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          rowCount: rows.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert governance_ocsf_events row(s)",
      );
      throw error;
    }
  }
}
