// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_ocsf_events`, owned by governance (goose 00026, 00027):
 * ReplacingMergeTree(LastUpdatedAt) over (TenantId, EventId), partitioned by EventTime.
 * No `timeColumn`: the builder admits only the fence's time-column names, and EventTime is not one.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });

export const governanceOcsfEvents = defineClickHouseTable({
  name: "governance_ocsf_events",
  tenantColumn: "TenantId",
  versionColumn: "LastUpdatedAt",
  sortKey: ["TenantId", "EventId"],
  columns: {
    TenantId: column.string(),
    OcsfSchemaVersion: column.lowCardinalityString(),
    EventId: column.string(),
    TraceId: column.string(),
    SourceId: column.string(),
    SourceType: column.lowCardinalityString(),
    ClassUid: column.uint32(),
    CategoryUid: column.uint32(),
    ActivityId: column.uint8(),
    TypeUid: column.uint32(),
    SeverityId: column.uint8(),
    EventTime: moment(),
    ActorUserId: column.string(),
    ActorEmail: column.string(),
    ActorEnduserId: column.string(),
    ActionName: column.string(),
    TargetName: column.string(),
    AnomalyAlertId: column.string(),
    RawOcsfJson: column.string(),
    CreatedAt: moment(),
    LastUpdatedAt: moment(),
  },
});
