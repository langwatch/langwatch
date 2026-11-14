/**
 * Which identity the client sends each statement on, and the tenant setting a reader read carries.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { describe, expect, it } from "vitest";

import { column } from "../builder/expression.ts";
import { clickhouseRead } from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { defineClickHouseTable } from "../builder/table.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { SystemIdentityAbsentError } from "../identity/statementIdentity.ts";
import { TENANT_IDS_SETTING, TenantSettingError } from "../identity/tenantSetting.ts";
import type { InsertRequest, QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

type Sent = { kind: "execute" | "stream" | "command"; request: QueryRequest };

/** A driver that records what it is sent and answers no rows. */
function recordingDriver(): QueryDriver & { sent: Sent[]; inserts: InsertRequest[] } {
  const sent: Sent[] = [];
  const inserts: InsertRequest[] = [];
  return {
    sent,
    inserts,
    execute: async <Row>(request: QueryRequest) => {
      sent.push({ kind: "execute", request });
      return { rows: [] as Row[] };
    },
    async *stream<Row>(request: QueryRequest): AsyncGenerator<Row[]> {
      sent.push({ kind: "stream", request });
      yield [];
    },
    command: async (request) => {
      sent.push({ kind: "command", request });
    },
    insert: async (request) => {
      inserts.push(request);
    },
  };
}

const TENANT_READ: QueryRequest = {
  tenantId: "project_a",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_a" },
  table: "trace_summaries",
};

const SET_READ: QueryRequest = {
  tenantId: "project_a",
  tenantIds: ["project_a", "project_b"],
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId IN ({tenants:Array(String)})",
  params: { tenants: ["project_a", "project_b"] },
  table: "trace_summaries",
};

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

/** The stream of a built statement, as replay sends it: a tenant set, or every tenant. */
const SET_STREAM = () =>
  clickhouseRead({ scope: tenantScope.set({ tenantIds: ["project_a", "project_b"] }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .build();

const ALL_TENANTS_STREAM = () =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason: "the test's own cross-tenant read" }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .build();

const SKIP_READ: QueryRequest = {
  tenantId: "project_a",
  sql: "SELECT name FROM system.columns",
  table: "system.columns",
  // The test's own cross-tenant read: the system schema, which no tenant owns.
  SKIP_TENANT_CHECK: true,
};

const COMMAND: QueryRequest = {
  tenantId: "project_a",
  sql: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_a" },
  table: "trace_summaries",
};

const INSERT: InsertRequest = {
  tenantId: "project_a",
  table: "trace_summaries",
  rows: [{ TenantId: "project_a", TraceId: "t1" }],
};

function bothIdentities() {
  const reader = recordingDriver();
  const system = recordingDriver();
  const client = new ClickHouseQueryClient({
    driver: system,
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
  });
  return { client, reader, system };
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const batch of stream) void batch;
}

describe("ClickHouseQueryClient identities", () => {
  describe("given a client holding the app reader and the system identity", () => {
    /** @scenario "A read sent as the app reader carries its declared tenant set as a request setting" */
    it("sends a tenant-set read on the reader with the set as its tenant setting", async () => {
      const { client, reader, system } = bothIdentities();

      await client.query(SET_READ);

      expect(system.sent).toEqual([]);
      expect(reader.sent).toHaveLength(1);
      const [sent] = reader.sent;
      expect(sent?.request.settings).toEqual({ [TENANT_IDS_SETTING]: "project_a,project_b" });
      expect(sent?.request.sql).toBe(SET_READ.sql);
    });

    /** @scenario "A read with one tenant carries that tenant alone" */
    it("sends a one-tenant read with that tenant alone, beside the caller's own settings", async () => {
      const { client, reader } = bothIdentities();

      await client.query({ ...TENANT_READ, settings: { max_memory_usage: 1 } });

      expect(reader.sent[0]?.request.settings).toEqual({
        max_memory_usage: 1,
        [TENANT_IDS_SETTING]: "project_a",
      });
    });

    /** @scenario "A read with no tenant set is refused before it is sent" */
    it.each([
      ["an empty tenant set", { ...SET_READ, tenantIds: [] }],
      ["an empty id in the set", { ...SET_READ, tenantIds: ["project_a", ""] }],
    ])("refuses a read declaring %s before any driver sees it", async (_, request) => {
      const { client, reader, system } = bothIdentities();
      // The tenant guard refuses some of these first; either way nothing is sent.
      const error = await refusalOf(() => client.query(request));

      expect(error).toBeInstanceOf(Error);
      expect([...reader.sent, ...system.sent]).toEqual([]);
    });

    /** @scenario "A tenant id carrying the setting's separator is refused" */
    it("refuses a tenant id that contains a comma", async () => {
      const { client, reader, system } = bothIdentities();
      const tenants = ["project_a", "project_b,project_c"];

      const error = await refusalOf(() =>
        client.query({ ...SET_READ, tenantIds: tenants, params: { tenants } }),
      );

      expect((error as TenantSettingError).violation).toEqual({
        kind: "tenant-id-separator",
        tenantId: "project_b,project_c",
      });
      expect([...reader.sent, ...system.sent]).toEqual([]);
    });

    /** @scenario "Statement text naming the setting prefix is refused on every identity" */
    it.each([
      [
        "a read",
        (client: ClickHouseQueryClient, sql: string) => client.query({ ...TENANT_READ, sql }),
      ],
      [
        "a skip-check read",
        (client: ClickHouseQueryClient, sql: string) => client.query({ ...SKIP_READ, sql }),
      ],
      [
        "a command",
        (client: ClickHouseQueryClient, sql: string) => client.command({ ...COMMAND, sql }),
      ],
    ])("refuses %s naming the prefix in any case", async (_, run) => {
      const { client, reader, system } = bothIdentities();
      const sql = `${TENANT_READ.sql} SETTINGS sql_LANGWATCH_tenant_ids = 'project_b'`;

      const error = await refusalOf(() => run(client, sql));

      expect((error as TenantSettingError).violation).toEqual({ kind: "setting-in-text" });
      expect([...reader.sent, ...system.sent]).toEqual([]);
    });

    /** @scenario "A caller's own tenant setting is refused unless it is the client's" */
    it.each([
      ["a wider tenant set", { [TENANT_IDS_SETTING]: "project_a,project_b" }],
      ["the enforce switch", { SQL_langwatch_tenancy_enforce: "0" }],
    ])("refuses a read carrying %s as its own setting", async (_, settings) => {
      const { client, reader } = bothIdentities();

      const error = await refusalOf(() => client.query({ ...TENANT_READ, settings }));

      expect((error as TenantSettingError).violation.kind).toBe("setting-supplied");
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "A caller's own tenant setting is refused unless it is the client's" */
    it("sends a read whose own tenant setting is exactly the set the client computes", async () => {
      const { client, reader } = bothIdentities();

      await client.query({
        ...SET_READ,
        settings: { [TENANT_IDS_SETTING]: "project_a,project_b" },
      });

      expect(reader.sent[0]?.request.settings).toEqual({
        [TENANT_IDS_SETTING]: "project_a,project_b",
      });
    });

    /** @scenario "Skip-check statements, commands and inserts are sent as the system" */
    it("sends skip-check reads and streams, commands and inserts on the system identity", async () => {
      const { client, reader, system } = bothIdentities();

      await client.query(SKIP_READ);
      await drain(client.stream({ statement: ALL_TENANTS_STREAM() }));
      await client.command(COMMAND);
      await client.insert(INSERT);

      expect(reader.sent).toEqual([]);
      expect(reader.inserts).toEqual([]);
      expect(system.sent.map(({ kind }) => kind)).toEqual(["execute", "stream", "command"]);
      expect(system.inserts).toEqual([INSERT]);
      for (const { request } of system.sent) {
        expect(request.settings?.[TENANT_IDS_SETTING]).toBeUndefined();
      }
    });

    /** @scenario "A read sent as the app reader carries its declared tenant set as a request setting" */
    it("streams a tenant read on the reader with its tenant setting", async () => {
      const { client, reader, system } = bothIdentities();

      await drain(client.stream({ statement: SET_STREAM() }));

      expect(system.sent).toEqual([]);
      expect(reader.sent.map(({ kind }) => kind)).toEqual(["stream"]);
      expect(reader.sent[0]?.request.settings?.[TENANT_IDS_SETTING]).toBe("project_a,project_b");
    });
  });

  describe("given a client holding only the app reader", () => {
    /** @scenario "A reader-only process refuses inserts, commands and skip-check statements by name" */
    it.each([
      ["insert", "trace_summaries", (client: ClickHouseQueryClient) => client.insert(INSERT)],
      ["command", "trace_summaries", (client: ClickHouseQueryClient) => client.command(COMMAND)],
      ["read", "system.columns", (client: ClickHouseQueryClient) => client.query(SKIP_READ)],
      [
        "stream",
        undefined,
        (client: ClickHouseQueryClient) =>
          drain(client.stream({ statement: ALL_TENANTS_STREAM() })),
      ],
    ])("refuses the %s by name, naming its table", async (operation, table, run) => {
      const reader = recordingDriver();
      const client = new ClickHouseQueryClient({
        readerDriver: reader,
        tenantGuard: new TenantGuard(),
      });

      const error = await refusalOf(() => run(client));

      expect(error).toBeInstanceOf(SystemIdentityAbsentError);
      expect(error).toMatchObject({
        code: "clickhouse_system_identity_absent",
        operation,
        table,
      });
      expect(reader.sent).toEqual([]);
      expect(reader.inserts).toEqual([]);
    });

    /** @scenario "A reader-only process refuses inserts, commands and skip-check statements by name" */
    it("refuses even an empty insert, which would otherwise send nothing", async () => {
      const client = new ClickHouseQueryClient({
        readerDriver: recordingDriver(),
        tenantGuard: new TenantGuard(),
      });

      const error = await refusalOf(() => client.insert({ ...INSERT, rows: [] }));

      expect(error).toBeInstanceOf(SystemIdentityAbsentError);
    });

    /** @scenario "A reader-only process refuses inserts, commands and skip-check statements by name" */
    it("still sends a tenant read on the reader", async () => {
      const reader = recordingDriver();
      const client = new ClickHouseQueryClient({
        readerDriver: reader,
        tenantGuard: new TenantGuard(),
      });

      await client.query(TENANT_READ);

      expect(reader.sent[0]?.request.settings?.[TENANT_IDS_SETTING]).toBe("project_a");
    });
  });

  describe("given a client holding only the system identity", () => {
    /** @scenario "A process holding only its one credential reads as before" */
    it("sends a tenant read on it without the tenant setting", async () => {
      const system = recordingDriver();
      const client = new ClickHouseQueryClient({ driver: system, tenantGuard: new TenantGuard() });

      await client.query(TENANT_READ);

      expect(system.sent).toHaveLength(1);
      expect(system.sent[0]?.request).toEqual(TENANT_READ);
    });

    /** @scenario "A process holding only its one credential reads as before" */
    it("still refuses a tenant id carrying the separator before sending", async () => {
      const system = recordingDriver();
      const client = new ClickHouseQueryClient({ driver: system, tenantGuard: new TenantGuard() });
      const tenants = ["project_a", "project_b,project_c"];

      const error = await refusalOf(() =>
        client.query({ ...SET_READ, tenantIds: tenants, params: { tenants } }),
      );

      expect(error).toBeInstanceOf(TenantSettingError);
      expect(system.sent).toEqual([]);
    });
  });

  describe("given no driver for either identity", () => {
    /** @scenario "A client with no identity at all is refused at construction" */
    it("refuses to build the client", () => {
      expect(() => new ClickHouseQueryClient({ tenantGuard: new TenantGuard() })).toThrow(
        /system or the reader identity/,
      );
    });
  });
});
