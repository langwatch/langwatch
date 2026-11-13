/**
 * The app reader's row policies on a real ClickHouse (26.8), provisioned from the rendered DDL
 * (ADR-202). The server must declare the `SQL_` settings prefix and let the URL's user manage
 * access.
 * @see specs/clickhouse/app-reader-row-policies.feature
 */
import { createHash } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PostgresNamedCollection } from "../../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import {
  APP_READER_NAMES,
  APP_READER_SETTINGS_PREFIX,
} from "../../rules/app-reader-access.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "../langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";

const url = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();

const DATABASE = `app_reader_${process.pid}`;
const READER_PASSWORD = "app-reader-test-password";
const TENANT_A = "project_a";
const TENANT_B = "project_b";
const TENANT_SETTING: string = APP_READER_NAMES.tenantSetting;
const SETTING_CONSTRAINT_VIOLATION = "452";

const NAMES: LangWatchQLNames = {
  database: DATABASE,
  restrictedUser: "app_reader_test_lwql",
  settingsProfile: "app_reader_test_lwql_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};
const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "app_reader_test_pg",
  host: "localhost",
  port: 5432,
  database: "langwatch",
  user: "reader",
  password: "unused",
};

/** Only the reader's statements: the LangWatchQL identity is not this suite's to provision. */
function readerDdl({ enforce }: { enforce: boolean }): string[] {
  const shared = {
    names: NAMES,
    passwordSha256Hex: "0".repeat(64),
    namedCollection: NAMED_COLLECTION,
    sourceDatabase: DATABASE,
  };
  const lwqlOnly = accessModelDefinition.renderDdl(accessModelDefinition.build(shared)).length;
  const passwordSha256Hex = createHash("sha256").update(READER_PASSWORD).digest("hex");
  return accessModelDefinition
    .renderDdl(
      accessModelDefinition.build({ ...shared, appReader: { passwordSha256Hex, enforce } }),
    )
    .slice(lwqlOnly);
}

const TABLES = [
  `CREATE TABLE ${DATABASE}.stored_spans (TenantId String, TraceId String, SpanId String)
     ENGINE = ReplacingMergeTree ORDER BY (TenantId, TraceId, SpanId) SETTINGS index_granularity = 8`,
  `CREATE TABLE ${DATABASE}.trace_summaries (TenantId String, TraceId String)
     ENGINE = ReplacingMergeTree ORDER BY (TenantId, TraceId)`,
  `CREATE TABLE ${DATABASE}.stored_objects (project_id String, id String)
     ENGINE = ReplacingMergeTree ORDER BY (project_id, id)`,
];

/** Each read returns one `TenantId` column; the reader must see tenant A's rows and only those. */
const SHAPES: Record<string, string> = {
  plain: `SELECT TenantId FROM ${DATABASE}.stored_spans`,
  cte: `WITH s AS (SELECT TenantId FROM ${DATABASE}.stored_spans) SELECT TenantId FROM s`,
  "union all": `SELECT TenantId FROM ${DATABASE}.stored_spans UNION ALL SELECT TenantId FROM ${DATABASE}.trace_summaries`,
  "join, left side": `SELECT s.TenantId AS TenantId FROM ${DATABASE}.stored_spans s LEFT JOIN ${DATABASE}.trace_summaries t ON s.TraceId = t.TraceId`,
  "join, right side": `SELECT t.TenantId AS TenantId FROM ${DATABASE}.stored_spans s RIGHT JOIN ${DATABASE}.trace_summaries t ON s.TraceId = t.TraceId`,
  subquery: `SELECT TenantId FROM (SELECT TenantId FROM ${DATABASE}.trace_summaries)`,
  "in subquery": `SELECT TenantId FROM ${DATABASE}.trace_summaries WHERE TraceId IN (SELECT TraceId FROM ${DATABASE}.stored_spans)`,
  "named foreign tenant": `SELECT TenantId FROM ${DATABASE}.stored_spans WHERE TenantId = '${TENANT_B}'`,
  "stored objects": `SELECT project_id AS TenantId FROM ${DATABASE}.stored_objects`,
  final: `SELECT TenantId FROM ${DATABASE}.trace_summaries FINAL`,
};

describe.runIf(Boolean(url))("given the app reader provisioned from the rendered DDL", () => {
  let admin: ClickHouseClient;
  let reader: ClickHouseClient;

  async function provision({ enforce }: { enforce: boolean }): Promise<void> {
    for (const statement of readerDdl({ enforce })) await admin.command({ query: statement });
  }

  async function tenantsOf(
    client: ClickHouseClient,
    query: string,
    tenantIds?: string,
  ): Promise<string[]> {
    const result = await client.query({
      query,
      format: "JSONEachRow",
      ...(tenantIds === undefined ? {} : { clickhouse_settings: { [TENANT_SETTING]: tenantIds } }),
    });
    const rows = await result.json<{ TenantId: string }>();
    return rows.map((row) => row.TenantId);
  }

  beforeAll(async () => {
    admin = createClient({ url });
    await admin
      .command({
        query: `SELECT 1 SETTINGS ${APP_READER_SETTINGS_PREFIX}langwatch_prefix_probe = 1`,
      })
      .catch((error: unknown) => {
        throw new Error("the server must list SQL_ in custom_settings_prefixes", { cause: error });
      });
    await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    for (const table of TABLES) await admin.command({ query: table });
    const spans = [TENANT_A, TENANT_B, "project_c"].flatMap((tenant) =>
      Array.from({ length: 100 }, (_, n) => ({
        TenantId: tenant,
        TraceId: `${tenant}-t${n % 2}`,
        SpanId: `s${n}`,
      })),
    );
    spans.push({ TenantId: "", TraceId: "orphan", SpanId: "orphan" });
    await admin.insert({ table: `${DATABASE}.stored_spans`, values: spans, format: "JSONEachRow" });
    await admin.insert({
      table: `${DATABASE}.trace_summaries`,
      values: [TENANT_A, TENANT_B].flatMap((t) =>
        [0, 1].map((n) => ({ TenantId: t, TraceId: `${t}-t${n}` })),
      ),
      format: "JSONEachRow",
    });
    await admin.insert({
      table: `${DATABASE}.stored_objects`,
      values: [
        { project_id: TENANT_A, id: "o1" },
        { project_id: TENANT_B, id: "o2" },
      ],
      format: "JSONEachRow",
    });
    const readerUrl = new URL(url ?? "");
    readerUrl.username = APP_READER_NAMES.user;
    readerUrl.password = READER_PASSWORD;
    reader = createClient({ url: readerUrl.toString() });
  });

  afterAll(async () => {
    await reader?.close();
    if (!admin) return;
    await admin.command({ query: `DROP USER IF EXISTS ${APP_READER_NAMES.user}` });
    await admin.command({
      query: `DROP SETTINGS PROFILE IF EXISTS ${APP_READER_NAMES.settingsProfile}`,
    });
    for (const statement of readerDdl({ enforce: false }).filter((s) =>
      s.startsWith("CREATE ROW POLICY"),
    )) {
      const [, name, table] = /^CREATE ROW POLICY OR REPLACE (\S+) ON (\S+)/.exec(statement) ?? [];
      if (name && table)
        await admin.command({ query: `DROP ROW POLICY IF EXISTS ${name} ON ${table}` });
    }
    await admin.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await admin.close();
  });

  describe("when the profile pins enforce to 1", () => {
    beforeAll(() => provision({ enforce: true }));

    /** @scenario "An enforcing reader naming tenant A reads only tenant A's rows in every query shape" */
    it.each(Object.entries(SHAPES))(
      "a %s read returns tenant A's rows only",
      async (shape, query) => {
        const tenants = await tenantsOf(reader, query, TENANT_A);
        expect(new Set(tenants)).toEqual(
          shape === "named foreign tenant" ? new Set() : new Set([TENANT_A]),
        );
      },
    );

    /** @scenario "An enforcing reader without a tenant set reads no rows" */
    it("reads no rows without a tenant set, nor with an empty id in it", async () => {
      expect(await tenantsOf(reader, SHAPES.plain ?? "")).toEqual([]);
      expect(await tenantsOf(reader, SHAPES["stored objects"] ?? "")).toEqual([]);
      expect(await tenantsOf(reader, SHAPES.plain ?? "", ",")).toEqual([]);
    });

    /** @scenario "The system identity reads every tenant's rows while the reader is enforced" */
    it("leaves the administrative identity reading every tenant", async () => {
      const tenants = new Set(await tenantsOf(admin, SHAPES.plain ?? ""));
      expect(tenants).toEqual(new Set([TENANT_A, TENANT_B, "project_c", ""]));
    });

    /** @scenario "The app reader's tenant predicate prunes on the primary key" */
    it("selects fewer granules than the table holds", async () => {
      const result = await reader.query({
        query: `EXPLAIN indexes = 1 SELECT count() FROM ${DATABASE}.stored_spans WHERE SpanId != ''`,
        format: "TabSeparatedRaw",
        clickhouse_settings: { [TENANT_SETTING]: TENANT_A },
      });
      const plan = await result.text();
      const primaryKey = /PrimaryKey[\s\S]*?Granules: (\d+)\/(\d+)/.exec(plan);
      expect(primaryKey, plan).not.toBeNull();
      expect(Number(primaryKey?.[1])).toBeLessThan(Number(primaryKey?.[2]));
    });

    const overrides: [string, Record<string, string>, string][] = [
      ["the enforce switch per request", { [APP_READER_NAMES.enforceSetting]: "0" }, ""],
      [
        "the enforce switch in a SETTINGS clause",
        {},
        ` SETTINGS ${APP_READER_NAMES.enforceSetting} = 0`,
      ],
      ["the condition cache per request", { use_query_condition_cache: "1" }, ""],
      ["the condition cache in a SETTINGS clause", {}, " SETTINGS use_query_condition_cache = 1"],
      ["the query cache in a SETTINGS clause", {}, " SETTINGS use_query_cache = 1"],
    ];
    /** @scenario "The reader cannot change the enforce switch or the cache pins" */
    it.each(overrides)("refuses %s", async (_name, settings, clause) => {
      await expect(
        reader.query({
          query: `SELECT count() FROM ${DATABASE}.stored_spans${clause}`,
          format: "JSONEachRow",
          clickhouse_settings: { [TENANT_SETTING]: TENANT_A, ...settings },
        }),
      ).rejects.toMatchObject({ code: SETTING_CONSTRAINT_VIOLATION });
    });
  });

  describe("when the profile pins enforce to 0 (shadow)", () => {
    beforeAll(() => provision({ enforce: false }));

    /** @scenario "A shadow reader reads every tenant's rows" */
    it("reads every tenant's rows with or without a tenant set", async () => {
      const everyone = new Set([TENANT_A, TENANT_B, "project_c", ""]);
      expect(new Set(await tenantsOf(reader, SHAPES.plain ?? ""))).toEqual(everyone);
      expect(new Set(await tenantsOf(reader, SHAPES.plain ?? "", TENANT_A))).toEqual(everyone);
    });
  });
});
