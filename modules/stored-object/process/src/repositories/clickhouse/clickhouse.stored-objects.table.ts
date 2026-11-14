/**
 * `stored_objects`, the legacy stored-object index owned by stored-object (ADR-202, goose 00023):
 * ReplacingMergeTree(inserted_at) over (project_id, id), its tenant column `project_id`.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const storedObjectsTable = defineClickHouseTable({
  name: "stored_objects",
  tenantColumn: "project_id",
  versionColumn: "inserted_at",
  sortKey: ["project_id", "id"],
  columns: {
    id: column.string(),
    project_id: column.string(),
    purpose: column.lowCardinality(column.string()),
    owner_kind: column.lowCardinality(column.string()),
    owner_id: column.string(),
    media_type: column.string(),
    size_bytes: column.uint64(),
    sha256: column.string(),
    storage_uri: column.string(),
    created_at: column.dateTime64({ precision: 3 }),
    inserted_at: column.dateTime64({ precision: 3 }),
  },
});
