/**
 * The server-metadata system tables (ADR-202): the only tables a `tenantScope.serverMetadata`
 * read names. None holds tenant rows; query_log, processes, mutations, query_views_log,
 * text_log, parts and disks are deliberately absent, and `from` refuses any table not listed.
 */
import { column } from "./expression.ts";
import { systemTable } from "./table.ts";

export const systemColumns = systemTable({
  name: "system.columns",
  columns: {
    database: column.string(),
    table: column.string(),
    name: column.string(),
    type: column.string(),
    comment: column.string(),
    position: column.uint64(),
  },
});

export const systemReplicas = systemTable({
  name: "system.replicas",
  columns: {
    database: column.string(),
    table: column.string(),
    total_replicas: column.uint8(),
    active_replicas: column.uint8(),
    is_readonly: column.uint8(),
    absolute_delay: column.uint64(),
    queue_size: column.uint32(),
  },
});

export const systemServerSettings = systemTable({
  name: "system.server_settings",
  columns: {
    name: column.string(),
    value: column.string(),
    changed: column.uint8(),
  },
});
