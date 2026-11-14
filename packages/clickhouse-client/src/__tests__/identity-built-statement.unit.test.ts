/**
 * A statement the typed builder built, sent on the identity it names with its own settings.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { AuthorizationExpiredError } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { column } from "../builder/expression.ts";
import { fn } from "../builder/functions.ts";
import {
  clickhouseRead,
  type MetadataReadStatement,
  type ReaderReadStatement,
} from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { systemColumns } from "../builder/system-tables.ts";
import { defineClickHouseTable } from "../builder/table.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { SystemIdentityAbsentError } from "../identity/statementIdentity.ts";
import { TENANT_IDS_SETTING, TenantSettingError } from "../identity/tenantSetting.ts";
import { defineIdIndex } from "../idIndexFlags.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

const traceSummaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
  },
});

function recordingDriver(): QueryDriver & { sent: QueryRequest[] } {
  const sent: QueryRequest[] = [];
  const refuse = () => Promise.reject(new Error("not a read"));
  return {
    sent,
    execute: async <Row>(request: QueryRequest) => {
      sent.push(request);
      return { rows: [] as Row[] };
    },
    command: refuse,
    insert: refuse,
  };
}

function clientWith({ system = true }: { system?: boolean } = {}) {
  const reader = recordingDriver();
  const systemDriver = recordingDriver();
  const client = new ClickHouseQueryClient({
    ...(system ? { driver: systemDriver } : {}),
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
  });
  return { client, reader, system: systemDriver };
}

const setRead = (): ReaderReadStatement =>
  clickhouseRead({ scope: tenantScope.set({ tenantIds: ["project_a", "project_b"] }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .build();

const allTenantsRead = () =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason: "retention sweep" }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .build();

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("ClickHouseQueryClient.read() of a built statement", () => {
  describe("given a reader statement", () => {
    /** @scenario "A built reader statement is sent on the reader with its own settings" */
    it("sends it on the reader with its settings as built, routed by its route tenant", async () => {
      const { client, reader, system } = clientWith();
      const statement = setRead();

      await client.read({ statement, table: "trace_summaries" });

      expect(system.sent).toEqual([]);
      expect(reader.sent).toHaveLength(1);
      expect(reader.sent[0]).toMatchObject({
        tenantId: statement.routeTenantId,
        tenantIds: statement.tenantIds,
        sql: statement.sql,
        settings: statement.settings,
      });
      expect(reader.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBe("project_a,project_b");
    });

    /** @scenario "A built statement whose tenant setting is not its tenant set is refused" */
    it.each([
      ["a wider tenant setting", "project_a,project_b,project_c"],
      ["no tenant setting", undefined],
    ])("refuses one carrying %s by name", async (_, carried) => {
      const { client, reader } = clientWith();
      const built = setRead();
      const { [TENANT_IDS_SETTING]: _own, ...pins } = built.settings;
      const statement = {
        ...built,
        settings: carried === undefined ? pins : { ...pins, [TENANT_IDS_SETTING]: carried },
      } as ReaderReadStatement;

      const error = await refusalOf(() => client.read({ statement }));

      expect(error).toBeInstanceOf(TenantSettingError);
      expect((error as TenantSettingError).violation).toMatchObject({ kind: "setting-mismatch" });
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "A braided built read is cut to its proof's expiry" */
    it("caps its time limit at the proof's remaining seconds", async () => {
      const { client, reader } = clientWith();
      const statement = { ...setRead(), expiresAt: Date.now() + 30_000 };

      await client.read({ statement });

      const limit = Number(reader.sent[0]?.settings?.max_execution_time);
      expect(limit).toBeGreaterThanOrEqual(29);
      expect(limit).toBeLessThanOrEqual(30);
    });

    /** @scenario "A braided built read is cut to its proof's expiry" */
    it("refuses it once its proof has expired, before it is sent", async () => {
      const { client, reader } = clientWith();
      const statement = { ...setRead(), expiresAt: Date.now() - 1 };

      const error = await refusalOf(() => client.read({ statement }));

      expect(error).toBeInstanceOf(AuthorizationExpiredError);
      expect(reader.sent).toEqual([]);
    });
  });

  describe("given an all-tenants statement", () => {
    /** @scenario "A built all-tenants statement is sent as the system" */
    it("sends it on the system identity with its settings, without a tenant setting", async () => {
      const { client, reader, system } = clientWith();
      const statement = allTenantsRead();

      await client.read({ statement, table: "trace_summaries" });

      expect(reader.sent).toEqual([]);
      expect(system.sent).toHaveLength(1);
      expect(system.sent[0]?.settings).toEqual(statement.settings);
      expect(system.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBeUndefined();
    });

    /** @scenario "A built all-tenants statement is sent as the system" */
    it("is refused by name in a reader-only process", async () => {
      const { client, reader } = clientWith({ system: false });

      const error = await refusalOf(() =>
        client.read({ statement: allTenantsRead(), table: "trace_summaries" }),
      );

      expect(error).toBeInstanceOf(SystemIdentityAbsentError);
      expect(reader.sent).toEqual([]);
    });
  });

  describe("given a server-metadata statement", () => {
    const metadataRead = (): MetadataReadStatement =>
      clickhouseRead({ scope: tenantScope.serverMetadata({ reason: "schema column list" }) })
        .from(systemColumns)
        .select({ name: systemColumns.name })
        .where(({ eq }) => eq(systemColumns.database, fn.currentDatabase()))
        .build();

    /** @scenario "A server-metadata read names only the allow-listed system tables" */
    it("sends it on the reader with no tenant setting, in a reader-only process", async () => {
      const { client, reader } = clientWith({ system: false });
      const statement = metadataRead();

      await client.read({ statement, table: "system.columns" });

      expect(reader.sent).toHaveLength(1);
      expect(reader.sent[0]?.sql).toBe(statement.sql);
      expect(reader.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBeUndefined();
      expect(reader.sent[0]?.SKIP_TENANT_CHECK).toBeUndefined();
    });

    /** @scenario "A server-metadata read names only the allow-listed system tables" */
    it("reads a tenant's column list as a metadata statement on the reader", async () => {
      const { client, reader, system } = clientWith();

      await client.columns({ tenantId: "project_a" }).select({ table: "t", columns: { A: "0" } });

      expect(system.sent).toEqual([]);
      expect(reader.sent).toHaveLength(1);
      expect(reader.sent[0]?.tenantId).toBe("project_a");
      expect(reader.sent[0]?.sql).toContain("FROM system.columns");
      expect(reader.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBeUndefined();
      expect(reader.sent[0]?.SKIP_TENANT_CHECK).toBeUndefined();
    });

    /** @scenario "A server-metadata read naming any other table is refused" */
    it("refuses a metadata statement whose text names a table off the allow-list", async () => {
      const { client, reader, system } = clientWith();
      const forged: MetadataReadStatement = {
        ...metadataRead(),
        sql: "SELECT query FROM system.query_log",
      };

      const error = await refusalOf(() => client.read({ statement: forged }));

      expect(error).toMatchObject({ code: "clickhouse_metadata_table_refused" });
      expect(reader.sent).toEqual([]);
      expect(system.sent).toEqual([]);
    });
  });

  describe("given a built read carrying an id bound or a full-scan declaration", () => {
    const storedSpans = defineClickHouseTable({
      name: "stored_spans",
      tenantColumn: "TenantId",
      timeColumn: "StartTime",
      sortKey: ["TenantId", "TraceId", "SpanId"],
      columns: {
        TenantId: column.string(),
        TraceId: column.string(),
        SpanId: column.string(),
        StartTime: column.dateTime64({ precision: 3 }),
      },
    });
    const boundRead = (): ReaderReadStatement =>
      clickhouseRead({ scope: tenantScope.set({ tenantIds: ["project_a", "project_b"] }) })
        .from(storedSpans)
        .select({ SpanId: storedSpans.SpanId })
        .where(({ idBound }) => idBound(storedSpans.TraceId, "trace_1"))
        .build();

    /** @scenario "A built reader statement is sent on the reader with its own settings" */
    it("expands its id bound as query() does and keeps the tenant setting on every window", async () => {
      const { client, reader } = clientWith();
      client.declareIdIndexes({
        indexes: [defineIdIndex({ source: "stored_spans", key: ["TraceId"], time: "StartTime" })],
      });
      const statement = boundRead();
      expect(statement.sql).toContain("{{idBound");

      await client.read({ statement, table: "stored_spans", idBound: { openEnded: true } });

      const reads = reader.sent.filter(({ sql }) => sql.includes("SpanId"));
      expect(reads.length).toBeGreaterThan(0);
      for (const sent of reads) {
        expect(sent.sql).not.toContain("{{idBound");
        expect(sent.settings?.[TENANT_IDS_SETTING]).toBe(statement.settings[TENANT_IDS_SETTING]);
      }
    });

    /** @scenario "A built reader statement is sent on the reader with its own settings" */
    it("sends a declared full scan as SKIP_COLD_SCAN_CHECK, and none otherwise", async () => {
      const { client, reader } = clientWith();

      await client.read({ statement: setRead(), table: "trace_summaries", declaresFullScan: true });
      await client.read({ statement: setRead(), table: "trace_summaries" });

      expect(reader.sent.map(({ SKIP_COLD_SCAN_CHECK }) => SKIP_COLD_SCAN_CHECK)).toEqual([
        true,
        undefined,
      ]);
    });
  });
});

/** A driver that streams the given batches, pausing between them, and records what it was sent. */
function streamingDriver({
  batches = [[]],
  pauseMs = 0,
}: { batches?: unknown[][]; pauseMs?: number } = {}): QueryDriver & { sent: QueryRequest[] } {
  const sent: QueryRequest[] = [];
  const refuse = () => Promise.reject(new Error("not a stream"));
  return {
    sent,
    execute: refuse,
    command: refuse,
    insert: refuse,
    stream: async function* <Row>(request: QueryRequest) {
      sent.push(request);
      for (const [index, batch] of batches.entries()) {
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        yield batch as Row[];
      }
    },
  };
}

function streamingClient({
  system = true,
  ...answers
}: { system?: boolean; batches?: unknown[][]; pauseMs?: number } = {}) {
  const reader = streamingDriver(answers);
  const systemDriver = streamingDriver(answers);
  const client = new ClickHouseQueryClient({
    ...(system ? { driver: systemDriver } : {}),
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
  });
  return { client, reader, system: systemDriver };
}

async function collect<Row>(batches: AsyncIterable<Row[]>): Promise<Row[][]> {
  const collected: Row[][] = [];
  for await (const batch of batches) collected.push(batch);
  return collected;
}

describe("ClickHouseQueryClient.stream() of a built statement", () => {
  describe("given a reader statement", () => {
    /** @scenario "A built reader statement is sent on the reader with its own settings" */
    it("streams it on the reader with its settings as built, and a declared full scan", async () => {
      const { client, reader, system } = streamingClient({ batches: [[{ TraceId: "t1" }]] });
      const statement = setRead();

      const batches = await collect(client.stream({ statement, declaresFullScan: true }));

      expect(batches).toEqual([[{ TraceId: "t1" }]]);
      expect(system.sent).toEqual([]);
      expect(reader.sent).toHaveLength(1);
      expect(reader.sent[0]).toMatchObject({
        tenantId: statement.tenantId,
        tenantIds: statement.tenantIds,
        sql: statement.sql,
        settings: statement.settings,
        SKIP_COLD_SCAN_CHECK: true,
      });
    });

    /** @scenario "A built statement whose tenant setting is not its tenant set is refused" */
    it("refuses one whose tenant setting is wider than its tenant set, before it is sent", async () => {
      const { client, reader } = streamingClient();
      const built = setRead();
      const statement = {
        ...built,
        settings: { ...built.settings, [TENANT_IDS_SETTING]: "project_a,project_b,project_c" },
      } as ReaderReadStatement;

      const error = await refusalOf(() => collect(client.stream({ statement })));

      expect(error).toBeInstanceOf(TenantSettingError);
      expect((error as TenantSettingError).violation).toMatchObject({ kind: "setting-mismatch" });
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "A braided built read is cut to its proof's expiry" */
    it("refuses it once its proof has expired, before it is sent", async () => {
      const { client, reader } = streamingClient();
      const statement = { ...setRead(), expiresAt: Date.now() - 1 };

      const error = await refusalOf(() => collect(client.stream({ statement })));

      expect(error).toBeInstanceOf(AuthorizationExpiredError);
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "A braided built read is cut to its proof's expiry" */
    it("refuses a batch that arrives after its proof has expired", async () => {
      const { client } = streamingClient({
        batches: [[{ TraceId: "t1" }], [{ TraceId: "t2" }]],
        pauseMs: 150,
      });
      const statement = { ...setRead(), expiresAt: Date.now() + 100 };
      const received: unknown[][] = [];

      const error = await refusalOf(async () => {
        for await (const batch of client.stream({ statement })) received.push(batch);
      });

      expect(error).toBeInstanceOf(AuthorizationExpiredError);
      expect(received).toEqual([[{ TraceId: "t1" }]]);
    });
  });

  describe("given an all-tenants statement", () => {
    /** @scenario "A built all-tenants statement is sent as the system" */
    it("streams it on the system identity, without a tenant setting", async () => {
      const { client, reader, system } = streamingClient();
      const statement = allTenantsRead();

      await collect(client.stream({ statement }));

      expect(reader.sent).toEqual([]);
      expect(system.sent).toHaveLength(1);
      expect(system.sent[0]).toMatchObject({ tenantId: "", sql: statement.sql });
      expect(system.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBeUndefined();
    });

    /** @scenario "A built all-tenants statement is sent as the system" */
    it("is refused by name in a reader-only process", async () => {
      const { client, reader } = streamingClient({ system: false });

      const error = await refusalOf(() => collect(client.stream({ statement: allTenantsRead() })));

      expect(error).toBeInstanceOf(SystemIdentityAbsentError);
      expect(error).toMatchObject({ operation: "stream" });
      expect(reader.sent).toEqual([]);
    });
  });
});
