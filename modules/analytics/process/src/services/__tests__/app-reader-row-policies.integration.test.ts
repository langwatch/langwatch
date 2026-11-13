/**
 * The app reader's row policies on a real ClickHouse (26.8), provisioned from the rendered DDL
 * (ADR-202). The server must declare the `SQL_` settings prefix and let the URL's user manage
 * access.
 * @see specs/clickhouse/app-reader-row-policies.feature
 */
import { randomBytes } from "node:crypto";

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
/** ClickHouse's `sha256_hash` of READER_PASSWORD, the form its user definitions take. */
const READER_PASSWORD_SHA256_HEX =
  "f49a03245c659f53b44f395763be47c64db9260bfb645f5acceaa6850788a56d";
const TENANT_A = "project_a";
const TENANT_B = "project_b";
/** Tenant A's id is a prefix of this one, so a substring match would admit it. */
const TENANT_AB = "project_ab";
const TENANT_SETTING: string = APP_READER_NAMES.tenantSetting;
const SETTING_CONSTRAINT_VIOLATION = "452";
const ACCESS_DENIED = "497";
const SPANS_PER_TENANT = 100;

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
  return accessModelDefinition
    .renderDdl(
      accessModelDefinition.build({
        ...shared,
        appReader: { passwordSha256Hex: READER_PASSWORD_SHA256_HEX, enforce },
      }),
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

/**
 * Every tenant's spans and summaries share the trace ids `t0` and `t1`, so a join that leaks a
 * side gains rows. Tenant B alone has a span on `t-inner`, where tenant A has only a summary: an
 * unfiltered inner side turns tenant A's lone summary into a match.
 */
const SPANS = [
  ...[TENANT_A, TENANT_B, TENANT_AB].flatMap((tenant) =>
    Array.from({ length: SPANS_PER_TENANT }, (_, n) => ({
      TenantId: tenant,
      TraceId: `t${n % 2}`,
      SpanId: `s${n}`,
    })),
  ),
  { TenantId: TENANT_B, TraceId: "t-inner", SpanId: "s-inner" },
  { TenantId: "", TraceId: "t0", SpanId: "orphan" },
];
const SUMMARIES = [
  ...[TENANT_A, TENANT_B, TENANT_AB].flatMap((tenant) =>
    ["t0", "t1"].map((TraceId) => ({ TenantId: tenant, TraceId })),
  ),
  { TenantId: TENANT_A, TraceId: "t-inner" },
];
const OBJECTS = [TENANT_A, TENANT_B, TENANT_AB].map((project_id) => ({ project_id, id: "o1" }));

/** Spans per tenant as stored; the empty tenant is the orphan row. */
const EVERY_TENANT = { [TENANT_A]: 100, [TENANT_B]: 101, [TENANT_AB]: 100, "": 1 };

/** Each read and the exact rows tenant A must get, as `column|column` keys with their counts. */
const SHAPES: Record<string, { query: string; rows: Record<string, number> }> = {
  plain: { query: `SELECT TenantId FROM ${DATABASE}.stored_spans`, rows: { [TENANT_A]: 100 } },
  cte: {
    query: `WITH s AS (SELECT TenantId FROM ${DATABASE}.stored_spans) SELECT TenantId FROM s`,
    rows: { [TENANT_A]: 100 },
  },
  "union all": {
    query:
      `SELECT TenantId FROM ${DATABASE}.stored_spans ` +
      `UNION ALL SELECT TenantId FROM ${DATABASE}.trace_summaries`,
    rows: { [TENANT_A]: 103 },
  },
  "inner join, both sides": {
    query:
      `SELECT s.TenantId AS span_tenant, t.TenantId AS summary_tenant FROM ${DATABASE}.stored_spans s ` +
      `INNER JOIN ${DATABASE}.trace_summaries t ON s.TraceId = t.TraceId`,
    rows: { [`${TENANT_A}|${TENANT_A}`]: 100 },
  },
  "left join, both sides": {
    query:
      `SELECT s.TenantId AS span_tenant, t.TenantId AS summary_tenant FROM ${DATABASE}.stored_spans s ` +
      `LEFT JOIN ${DATABASE}.trace_summaries t ON s.TraceId = t.TraceId`,
    rows: { [`${TENANT_A}|${TENANT_A}`]: 100 },
  },
  "right join, both sides": {
    query:
      `SELECT s.TenantId AS span_tenant, t.TenantId AS summary_tenant FROM ${DATABASE}.stored_spans s ` +
      `RIGHT JOIN ${DATABASE}.trace_summaries t ON s.TraceId = t.TraceId`,
    rows: { [`${TENANT_A}|${TENANT_A}`]: 100, [`|${TENANT_A}`]: 1 },
  },
  subquery: {
    query: `SELECT TenantId FROM (SELECT TenantId FROM ${DATABASE}.trace_summaries)`,
    rows: { [TENANT_A]: 3 },
  },
  "in subquery, inner side": {
    query:
      `SELECT TenantId, TraceId FROM ${DATABASE}.trace_summaries ` +
      `WHERE TraceId IN (SELECT TraceId FROM ${DATABASE}.stored_spans)`,
    rows: { [`${TENANT_A}|t0`]: 1, [`${TENANT_A}|t1`]: 1 },
  },
  "named foreign tenant": {
    query: `SELECT TenantId FROM ${DATABASE}.stored_spans WHERE TenantId = '${TENANT_B}'`,
    rows: {},
  },
  "stored objects": {
    query: `SELECT project_id, id FROM ${DATABASE}.stored_objects`,
    rows: { [`${TENANT_A}|o1`]: 1 },
  },
  final: {
    query: `SELECT TenantId, TraceId FROM ${DATABASE}.trace_summaries FINAL`,
    rows: { [`${TENANT_A}|t0`]: 1, [`${TENANT_A}|t1`]: 1, [`${TENANT_A}|t-inner`]: 1 },
  },
};
const PLAIN = SHAPES.plain?.query ?? "";

/** Tenant sets and the spans a plain read gets per tenant: ids are exact, comma-separated. */
const TENANT_SETS: [string, string, Record<string, number>][] = [
  ["an id that is a prefix of another", TENANT_A, { [TENANT_A]: 100 }],
  ["the id it is a prefix of", TENANT_AB, { [TENANT_AB]: 100 }],
  ["a prefix shared by every id", "project", {}],
  ["empty entries around an id", `,${TENANT_A},,`, { [TENANT_A]: 100 }],
  ["an id with a leading space", ` ${TENANT_A}`, {}],
  ["a second id after a space", `${TENANT_A}, ${TENANT_B}`, { [TENANT_A]: 100 }],
  ["two allowed tenants", `${TENANT_A},${TENANT_B}`, { [TENANT_A]: 100, [TENANT_B]: 101 }],
];

/** Tables holding another session's statements; the reader is granted none of them. */
const DENIED_LOGS = ["query_log", "processes", "query_views_log", "text_log"];

describe.runIf(Boolean(url))("given the app reader provisioned from the rendered DDL", () => {
  let admin: ClickHouseClient;
  let reader: ClickHouseClient;

  async function provision({ enforce }: { enforce: boolean }): Promise<void> {
    for (const statement of readerDdl({ enforce })) await admin.command({ query: statement });
  }

  async function rowsOf(
    client: ClickHouseClient,
    query: string,
    tenantIds?: string,
  ): Promise<Record<string, unknown>[]> {
    const result = await client.query({
      query,
      format: "JSONEachRow",
      ...(tenantIds === undefined ? {} : { clickhouse_settings: { [TENANT_SETTING]: tenantIds } }),
    });
    return result.json<Record<string, unknown>>();
  }

  /** Every row as its values joined by `|`, counted: no row is deduplicated away. */
  async function tally(
    client: ClickHouseClient,
    query: string,
    tenantIds?: string,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const row of await rowsOf(client, query, tenantIds)) {
      const key = Object.values(row).map(String).join("|");
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
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
    const inserts: [string, Record<string, string>[]][] = [
      ["stored_spans", SPANS],
      ["trace_summaries", SUMMARIES],
      ["stored_objects", OBJECTS],
    ];
    for (const [table, values] of inserts) {
      await admin.insert({ table: `${DATABASE}.${table}`, values, format: "JSONEachRow" });
    }
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
      "a %s read returns exactly tenant A's rows",
      async (_shape, { query, rows }) => {
        expect(await tally(reader, query, TENANT_A)).toEqual(rows);
      },
    );

    /** @scenario "The tenant set is read as exact comma-separated ids" */
    it.each(TENANT_SETS)("reads %s as exact ids", async (_case, tenantIds, rows) => {
      expect(await tally(reader, PLAIN, tenantIds)).toEqual(rows);
    });

    /** @scenario "An enforcing reader without a tenant set reads no rows" */
    it("reads no rows without a tenant set, nor with an empty id in it", async () => {
      expect(await rowsOf(reader, PLAIN)).toEqual([]);
      expect(await rowsOf(reader, SHAPES["stored objects"]?.query ?? "")).toEqual([]);
      expect(await rowsOf(reader, PLAIN, ",")).toEqual([]);
    });

    /** @scenario "A reader for one tenant cannot read another tenant's logged statements" */
    it("keeps tenant B's statement out of every log the reader for tenant A can name", async () => {
      const marker = `app-reader-log-${randomBytes(6).toString("hex")}`;
      await rowsOf(
        reader,
        `SELECT TenantId, '${marker}-b' AS m FROM ${DATABASE}.stored_spans`,
        TENANT_B,
      );
      await admin.command({ query: "SYSTEM FLUSH LOGS" });
      // Searched as two halves, so no probe's own text holds the marker it looks for.
      const holdsMarker = `position(query, concat('${marker}', '-b')) > 0`;

      const logged = await rowsOf(
        admin,
        `SELECT query FROM system.query_log WHERE user = '${APP_READER_NAMES.user}' AND ${holdsMarker}`,
      );
      expect(logged.length, "the server logged tenant B's statement").toBeGreaterThan(0);
      expect(
        await rowsOf(
          reader,
          `SELECT query FROM system.user_query_log WHERE ${holdsMarker}`,
          TENANT_A,
        ),
      ).toEqual([]);
      for (const table of DENIED_LOGS) {
        await expect(
          rowsOf(reader, `SELECT * FROM system.${table} LIMIT 1`, TENANT_A),
          `system.${table}`,
        ).rejects.toMatchObject({ code: ACCESS_DENIED });
      }
    });

    /** @scenario "The system identity reads every tenant's rows while the reader is enforced" */
    it("leaves the administrative identity reading every tenant", async () => {
      expect(await tally(admin, PLAIN)).toEqual(EVERY_TENANT);
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
      expect(await tally(reader, PLAIN)).toEqual(EVERY_TENANT);
      expect(await tally(reader, PLAIN, TENANT_A)).toEqual(EVERY_TENANT);
    });
  });
});
