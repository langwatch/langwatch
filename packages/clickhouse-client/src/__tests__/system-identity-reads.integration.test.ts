/**
 * On 26.8: why ops' storage footprint and data retention's system-table reads leave as the
 * system (the reader sees only its granted tables, and no parts, disks, backups or mutations),
 * and that each built read returns the rows main's raw query returns.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SystemReadStatement } from "../builder/read.ts";
import {
  systemBackupLog,
  systemDisks,
  systemMutations,
  systemParts,
  systemTables,
} from "../builder/system-tables.ts";
import {
  TEST_CLICKHOUSE_IMAGE,
  TEST_CLICKHOUSE_TUNING,
  testClickHouseProfilePins,
} from "../clickhouse-test-endpoints.ts";
import { idIndexTenantsStatement } from "../idIndexRetention.ts";
import * as reads from "./fixtures/system-identity-reads.ts";

const DATABASE = `system_identity_${process.pid}`;
const READER = `system_identity_reader_${process.pid}`;
const READER_PASSWORD = "system-identity-reader-test-login";
const TABLES = ["stored_spans", "event_log", "stored_spans_id_index"];

let container: StartedClickHouseContainer | undefined;
let system: ClickHouseClient;
let reader: ClickHouseClient;

/** Each row as `value|value` text, sorted, so ties in `ORDER BY create_time` do not matter. */
async function rawRows({
  sql,
  params = {},
}: {
  sql: string;
  params?: Record<string, unknown>;
}): Promise<string[]> {
  const result = await system.query({ query: sql, query_params: params, format: "JSONEachRow" });
  const rows = await result.json<Record<string, unknown>>();
  return rows.map((row) => Object.values(row).map(String).join("|")).toSorted();
}

async function builtRows({ statement }: { statement: SystemReadStatement }): Promise<string[]> {
  const result = await system.query({
    query: statement.sql,
    query_params: { ...statement.params },
    clickhouse_settings: { ...statement.settings } as Record<string, string | number>,
    format: "JSONEachRow",
  });
  const rows = await result.json<Record<string, unknown>>();
  return rows.map((row) => Object.values(row).map(String).join("|")).toSorted();
}

async function readerCodeOf({ sql }: { sql: string }): Promise<unknown> {
  try {
    await (await reader.query({ query: sql, format: "JSONEachRow" })).json();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return "answered";
}

const MAIN = {
  footprint: `SELECT table, sum(rows) as total_rows, sum(bytes_on_disk) as total_bytes,
      count() as parts_count FROM system.parts WHERE database = currentDatabase() AND active = 1
      AND table IN ({tables:Array(String)}) GROUP BY table`,
  disks: "SELECT name, total_space FROM system.disks",
  hasBackupLog:
    "SELECT count() AS present FROM system.tables WHERE database = 'system' AND name = 'backup_log'",
  backups: `SELECT status, count() as cnt,
      maxIf(end_time, status = 'BACKUP_CREATED') as last_success_time,
      argMaxIf(total_size, end_time, status = 'BACKUP_CREATED') as last_success_size
      FROM system.backup_log GROUP BY status`,
  held: "SELECT name FROM system.tables WHERE database = currentDatabase() AND name IN {tables:Array(String)}",
  progress: `SELECT mutation_id AS mutationId, table AS table, is_done AS isDone,
      parts_to_do AS partsToDo, formatDateTime(create_time, '%Y-%m-%dT%H:%i:%S') AS createTime,
      command AS command FROM system.mutations WHERE position(command, '_retention_days') > 0
      AND position(command, {tenantFilterNeedle:String}) > 0 AND is_done = 0
      ORDER BY create_time DESC`,
  keepForever: `SELECT mutation_id AS mutationId, is_done AS isDone,
      toUInt32(parts_to_do) AS partsToDo, latest_fail_reason AS latestFailReason,
      table AS table, command AS command FROM system.mutations
      WHERE database = currentDatabase() AND table IN {tables:Array(String)}
      AND position(command, '_retention_days = 0') > 0 ORDER BY create_time DESC`,
  idIndexTenants: "SELECT DISTINCT TenantId FROM stored_spans_id_index",
  partsMissing: `SELECT toUInt32(count()) AS parts FROM (SELECT name FROM system.parts_columns
      WHERE database = currentDatabase() AND table = 'trace_analytics' AND active GROUP BY name
      HAVING countIf(has({columns:Array(String)}, column)) < length({columns:Array(String)}))`,
};
const METADATA_COLUMNS = ["MetadataA", "MetadataB"];

describe("given ClickHouse 26.8, two tenants' tables, a table the reader is not granted, and retention rewrites", () => {
  beforeAll(async () => {
    const pins = testClickHouseProfilePins();
    container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
      .withEnvironment({ CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1" })
      .withCopyContentToContainer([TEST_CLICKHOUSE_TUNING, pins.file])
      .withStartupTimeout(120_000)
      .start();
    const url = container.getHttpUrl();
    const login = { url, username: container.getUsername(), password: container.getPassword() };
    const admin = createClient(login);
    await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    await admin.close();
    system = createClient({ ...login, database: DATABASE });
    for (const query of [
      `CREATE TABLE stored_spans (TenantId String, SpanId String, _retention_days UInt16)
         ENGINE = MergeTree ORDER BY (TenantId, SpanId)`,
      `CREATE TABLE event_log (TenantId String, EventId String, _retention_days UInt16)
         ENGINE = MergeTree ORDER BY (TenantId, EventId)`,
      `CREATE TABLE stored_spans_id_index (TenantId String, Id String)
         ENGINE = MergeTree ORDER BY (TenantId, Id)`,
      `CREATE TABLE trace_analytics (TenantId String, TraceId String, MetadataA String)
         ENGINE = MergeTree ORDER BY (TenantId, TraceId)`,
      ...[...TABLES, "trace_analytics"].map((table) => `SYSTEM STOP MERGES ${table}`),
      "INSERT INTO trace_analytics VALUES ('tenant_a', 't1', 'a')",
      "ALTER TABLE trace_analytics ADD COLUMN MetadataB String",
      "INSERT INTO trace_analytics VALUES ('tenant_b', 't2', 'a', 'b')",
      "INSERT INTO stored_spans VALUES ('tenant_a', 's1', 30), ('tenant_b', 's2', 30)",
      "INSERT INTO event_log VALUES ('tenant_a', 'e1', 30), ('tenant_b', 'e2', 30)",
      "INSERT INTO stored_spans_id_index VALUES ('', 'marker'), ('tenant_a', 's1'), ('tenant_b', 's2')",
      "ALTER TABLE stored_spans UPDATE _retention_days = 7 WHERE TenantId = 'tenant_a'",
      "ALTER TABLE stored_spans UPDATE _retention_days = 90 WHERE TenantId = 'tenant_b'",
      "ALTER TABLE event_log UPDATE _retention_days = 0 WHERE TenantId = 'tenant_a'",
      `BACKUP TABLE ${DATABASE}.stored_spans TO Memory('system_identity_backup')`,
      "SYSTEM FLUSH LOGS",
      `CREATE USER ${READER} IDENTIFIED WITH plaintext_password BY '${READER_PASSWORD}'`,
      `GRANT SELECT ON ${DATABASE}.stored_spans TO ${READER}`,
      ...["columns", "replicas", "server_settings"].map(
        (table) => `GRANT SELECT ON system.${table} TO ${READER}`,
      ),
    ]) {
      await system.command({ query });
    }
    reader = createClient({ url, username: READER, password: READER_PASSWORD, database: DATABASE });
  }, 300_000);

  afterAll(async () => {
    await reader?.close();
    await system?.close();
    await container?.stop();
  }, 60_000);

  describe("when the reader reads the system tables those reads need", () => {
    for (const table of ["parts", "disks", "backup_log", "mutations"]) {
      /** @scenario "On 26.8 the reader cannot list what the system-table reads need" */
      it(`is refused system.${table} as access denied`, async () => {
        expect(await readerCodeOf({ sql: `SELECT count() FROM system.${table}` })).toBe("497");
      });
    }

    /** @scenario "On 26.8 the reader cannot list what the system-table reads need" */
    it("sees in system.tables the granted table and not the other", async () => {
      const result = await reader.query({
        query: "SELECT name FROM system.tables WHERE database = currentDatabase() ORDER BY name",
        format: "JSONEachRow",
      });

      expect(await result.json()).toEqual([{ name: "stored_spans" }]);
    });
  });

  describe("when each system-table read is built and sent as the system", () => {
    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("declares only columns the server's system tables hold", async () => {
      for (const table of [
        systemParts,
        systemDisks,
        systemBackupLog,
        systemTables,
        systemMutations,
      ]) {
        const [, name] = table.$table.stored.split(".");
        const result = await system.query({
          query:
            "SELECT name FROM system.columns WHERE database = 'system' AND table = {table:String}",
          query_params: { table: name },
          format: "JSONEachRow",
        });
        const held = new Set((await result.json<{ name: string }>()).map((row) => row.name));

        expect(table.$table.columns.filter((column) => !held.has(column))).toEqual([]);
      }
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("returns the storage footprint of every table, the ungranted one included", async () => {
      const built = await builtRows({ statement: reads.footprintTablesRead({ tables: TABLES }) });

      expect(built).toEqual(await rawRows({ sql: MAIN.footprint, params: { tables: TABLES } }));
      expect(built.map((row) => row.split("|")[0]).toSorted()).toEqual(TABLES.toSorted());
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("returns each disk with its used space as total less free", async () => {
      const result = await system.query({
        query: reads.footprintDisksRead().sql,
        clickhouse_settings: { ...reads.footprintDisksRead().settings },
        format: "JSONEachRow",
      });
      const disks = await result.json<Record<string, string>>();

      expect(disks.map((disk) => `${disk.name}|${disk.total_space}`).toSorted()).toEqual(
        await rawRows({ sql: MAIN.disks }),
      );
      for (const disk of disks) {
        expect(BigInt(disk.used_space!)).toBe(BigInt(disk.total_space!) - BigInt(disk.free_space!));
      }
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("finds the backup log and returns its statuses, comparing the Enum8 status with a bound name", async () => {
      expect(await builtRows({ statement: reads.hasBackupLogRead() })).toEqual(["1"]);
      const built = await builtRows({ statement: reads.backupStatusesRead() });

      expect(built).toEqual(await rawRows({ sql: MAIN.backups }));
      expect(built.some((row) => row.startsWith("BACKUP_CREATED|1|"))).toBe(true);
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("returns the held tables, the event log the reader cannot see included", async () => {
      const tables = ["event_log", "stored_spans_id_index", "absent_id_index"];
      const built = await builtRows({ statement: reads.heldTablesRead({ tables }) });

      expect(built).toEqual(await rawRows({ sql: MAIN.held, params: { tables } }));
      expect(built).toEqual(["event_log", "stored_spans_id_index"]);
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("returns one project's open rewrites and not the other tenant's", async () => {
      const needle = "TenantId = 'tenant_a'";
      const built = await builtRows({ statement: reads.mutationProgressRead({ needle }) });

      expect(built).toEqual(
        await rawRows({ sql: MAIN.progress, params: { tenantFilterNeedle: needle } }),
      );
      expect(built).toHaveLength(2);
      expect(built.every((row) => row.includes("tenant_a") && !row.includes("tenant_b"))).toBe(
        true,
      );
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("returns the keep-forever rewrite of the event log", async () => {
      const tables = ["event_log"];
      const built = await builtRows({ statement: reads.keepForeverRewritesRead({ tables }) });

      expect(built).toEqual(await rawRows({ sql: MAIN.keepForever, params: { tables } }));
      expect(built).toHaveLength(1);
    });

    /** @scenario "The parts lacking a table's columns, counted over a derived system read, run on 26.8 as main's raw query does" */
    it("counts the one part written before a listed column was added, as main's raw read does", async () => {
      const statement = reads.partsMissingColumnsRead({
        table: "trace_analytics",
        columns: METADATA_COLUMNS,
      });
      const built = await builtRows({ statement });

      expect(statement.identity).toBe("system");
      expect(built).toEqual(
        await rawRows({ sql: MAIN.partsMissing, params: { columns: METADATA_COLUMNS } }),
      );
      expect(built).toEqual(["1"]);
    });

    /** @scenario "A read whose where is the constant false returns no row on 26.8" */
    it("returns no row for a read whose where is cond.never()", async () => {
      expect(await builtRows({ statement: reads.everySpanRead() })).toHaveLength(2);
      expect(await builtRows({ statement: reads.everySpanRead({ none: true }) })).toEqual([]);
    });

    /** @scenario "The system-table reads run on 26.8 as main's raw queries do" */
    it("lists every tenant an id index holds, the marker row's empty id included", async () => {
      const statement = idIndexTenantsStatement({ index: "stored_spans_id_index" });
      const built = await builtRows({ statement });

      expect(built).toEqual(await rawRows({ sql: MAIN.idIndexTenants }));
      expect(built).toEqual(["", "tenant_a", "tenant_b"]);
    });
  });
});
