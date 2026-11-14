/**
 * Ops' storage footprint and data retention's system-table reads, built as their ports will write
 * them (handoff rp-b9-builder-system-tables, section 12). The unit and 26.8 suites share them; the
 * 26.8 suite holds main's raw text beside each.
 */
import { column, cond, param } from "../../builder/expression.ts";
import { fn } from "../../builder/functions.ts";
import { clickhouseRead } from "../../builder/read.ts";
import { defineClickHouseTable } from "../../builder/table.ts";
import { tenantScope } from "../../builder/scope.ts";
import {
  systemBackupLog,
  systemDisks,
  systemMutations,
  systemParts,
  systemPartsColumns,
  systemTables,
} from "../../builder/system-tables.ts";

const systemRead = ({ reason }: { reason: string }) =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason }) });

export const footprintTablesRead = ({ tables }: { tables: readonly string[] }) =>
  systemRead({ reason: "per-table storage size for the operator's dashboards" })
    .from(systemParts)
    .select({
      table: systemParts.table,
      total_rows: fn.sum(systemParts.rows),
      total_bytes: fn.sum(systemParts.bytes_on_disk),
      parts_count: fn.count(),
    })
    .where(({ and, eq, oneOf }) =>
      and(
        eq(systemParts.database, fn.currentDatabase()),
        eq(systemParts.active, 1),
        oneOf(systemParts.table, tables),
      ),
    )
    .groupBy(systemParts.table)
    .build();

export const footprintDisksRead = () =>
  systemRead({ reason: "the instance's disk capacity" })
    .from(systemDisks)
    .select({
      name: systemDisks.name,
      total_space: systemDisks.total_space,
      free_space: systemDisks.free_space,
      used_space: fn.minus(systemDisks.total_space, systemDisks.free_space),
    })
    .build();

export const hasBackupLogRead = () =>
  systemRead({ reason: "whether the server keeps a backup log" })
    .from(systemTables)
    .select({ present: fn.count() })
    .where(({ and, eq }) =>
      and(eq(systemTables.database, "system"), eq(systemTables.name, "backup_log")),
    )
    .build();

export const backupStatusesRead = () => {
  const created = cond.eq(systemBackupLog.status, "BACKUP_CREATED");
  return systemRead({ reason: "the instance's backup history" })
    .from(systemBackupLog)
    .select({
      status: systemBackupLog.status,
      cnt: fn.count(),
      last_success_time: fn.maxIf(systemBackupLog.end_time, created),
      last_success_size: fn.argMaxIf(systemBackupLog.total_size, systemBackupLog.end_time, created),
    })
    .groupBy(systemBackupLog.status)
    .build();
};

export const heldTablesRead = ({ tables }: { tables: readonly string[] }) =>
  systemRead({ reason: "which of the named tables the routed server holds" })
    .from(systemTables)
    .select({ name: systemTables.name })
    .where(({ and, eq, oneOf }) =>
      and(eq(systemTables.database, fn.currentDatabase()), oneOf(systemTables.name, tables)),
    )
    .build();

/** findMutationProgress: one project's open rewrites, matched by a needle in each command. */
export const mutationProgressRead = ({ needle }: { needle: string }) =>
  systemRead({ reason: "a project's retention rewrites, matched in each mutation's command" })
    .from(systemMutations)
    .select({
      mutationId: systemMutations.mutation_id,
      table: systemMutations.table,
      isDone: systemMutations.is_done,
      partsToDo: systemMutations.parts_to_do,
      createTime: fn.formatDateTime(systemMutations.create_time, "%Y-%m-%dT%H:%i:%S"),
      command: systemMutations.command,
    })
    .where(({ and, eq, gt }) =>
      and(
        gt(fn.position(systemMutations.command, "_retention_days"), 0),
        gt(fn.position(systemMutations.command, needle), 0),
        eq(systemMutations.is_done, 0),
      ),
    )
    .orderBy(systemMutations.create_time, "DESC")
    .build();

/** findKeepForeverRewrites: every tenant's keep-forever rewrite of the named tables on a target. */
export const keepForeverRewritesRead = ({ tables }: { tables: readonly string[] }) =>
  systemRead({ reason: "the event log's keep-forever rewrite spans every tenant on a target" })
    .from(systemMutations)
    .select({
      mutationId: systemMutations.mutation_id,
      isDone: systemMutations.is_done,
      partsToDo: fn.toUInt32(systemMutations.parts_to_do),
      latestFailReason: systemMutations.latest_fail_reason,
      table: systemMutations.table,
      command: systemMutations.command,
    })
    .where(({ and, eq, gt, oneOf }) =>
      and(
        eq(systemMutations.database, fn.currentDatabase()),
        oneOf(systemMutations.table, tables),
        gt(fn.position(systemMutations.command, "_retention_days = 0"), 0),
      ),
    )
    .orderBy(systemMutations.create_time, "DESC")
    .build();

/** Trace's parts lacking a listed column: a count over a derived read of system.parts_columns. */
export const partsMissingColumnsRead = ({
  table,
  columns,
}: {
  table: string;
  columns: readonly string[];
}) => {
  const read = systemRead({ reason: "parts written before the metadata columns were added" });
  const wanted = param.strings(columns);
  const lacking = read
    .from(systemPartsColumns)
    .select({ PartName: systemPartsColumns.name })
    .where(({ and, eq }) =>
      and(
        eq(systemPartsColumns.database, fn.currentDatabase()),
        eq(systemPartsColumns.table, table),
        eq(systemPartsColumns.active, 1),
      ),
    )
    .groupBy(systemPartsColumns.name)
    .having(({ lt }) =>
      lt(
        fn.countIf(fn.has(wanted, systemPartsColumns.column)),
        fn.length(wanted),
      ),
    )
    .as("lacking");
  return read.from(lacking).select({ parts: fn.toUInt32(fn.count()) }).build();
};

const storedSpans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "SpanId"],
  columns: { TenantId: column.string(), SpanId: column.string() },
});

/** Every tenant's spans, or none when `none` makes the where `cond.never()`. */
export const everySpanRead = ({ none = false }: { none?: boolean } = {}) => {
  const read = systemRead({ reason: "a constant false, proven on the server" })
    .from(storedSpans)
    .select({ SpanId: storedSpans.SpanId });
  return (none ? read.where(() => cond.never()) : read).build();
};
