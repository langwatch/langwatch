/**
 * The system tables a typed read names (ADR-202): columns, replicas and server settings on the
 * reader with no tenant setting; parts, disks, tables, backup_log and mutations only on the system
 * identity. query_log, processes, query_views_log and text_log are on neither list.
 */
import { column } from "./expression.ts";
import { systemIdentityTable, systemTable } from "./table.ts";

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

/** Every table's parts on the server, the ones the reader is not granted included. */
export const systemParts = systemIdentityTable({
  name: "system.parts",
  columns: {
    database: column.string(),
    table: column.string(),
    active: column.uint8(),
    rows: column.uint64(),
    bytes_on_disk: column.uint64(),
  },
});

export const systemDisks = systemIdentityTable({
  name: "system.disks",
  columns: {
    name: column.string(),
    total_space: column.uint64(),
    free_space: column.uint64(),
  },
});

/** `status` is an Enum8 the server compares with a bound String by its name. */
export const systemBackupLog = systemIdentityTable({
  name: "system.backup_log",
  columns: {
    status: column.string(),
    end_time: column.dateTime64({ precision: 6 }),
    total_size: column.uint64(),
  },
});

/** Every table on the server; the reader's view lists only the tables it is granted. */
export const systemTables = systemIdentityTable({
  name: "system.tables",
  columns: {
    database: column.string(),
    name: column.string(),
  },
});

/** Each mutation's `command` names the tenants it rewrites, so no reader may list it. */
export const systemMutations = systemIdentityTable({
  name: "system.mutations",
  columns: {
    database: column.string(),
    table: column.string(),
    mutation_id: column.string(),
    command: column.string(),
    latest_fail_reason: column.string(),
    is_done: column.uint8(),
    parts_to_do: column.int64(),
    create_time: column.dateTime(),
  },
});

/** Each active part's columns; lists parts of every table, so only the system identity reads it. */
export const systemPartsColumns = systemIdentityTable({
  name: "system.parts_columns",
  columns: {
    database: column.string(),
    table: column.string(),
    name: column.string(),
    column: column.string(),
    active: column.uint8(),
  },
});
