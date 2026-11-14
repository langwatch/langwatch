/**
 * ADR-202 slice 3 on a throwaway ClickHouse 26.8: materialised views fire for system-identity
 * inserts once the readers' policies exist, neither reader may insert, and the query condition
 * cache keeps tenants apart under the setting-keyed policy (Decided 10).
 * @see specs/clickhouse/app-reader-row-policies.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PostgresNamedCollection } from "../../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import {
  APP_READER_NAMES,
  APP_READER_SETTINGS_PREFIX,
  APP_READER_TENANT_TABLES,
} from "../../rules/app-reader-access.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "../langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";

const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();

const READER_LOGIN = "app-reader-identity-login";
const ENFORCING_LOGIN = "app-reader-enforcing-login";
const ENFORCING_USER = `${APP_READER_NAMES.user}_enforcing`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const TENANT_SETTING: string = APP_READER_NAMES.tenantSetting;
const ACCESS_DENIED = "497";
const CACHE_DATABASE = `app_reader_cache_${process.pid}`;
const TENANT_A = "project_a";
const TENANT_B = "project_b";
const CONDITION = "SpanId LIKE 's1%'";

/** Values a view's own filter requires, beside the generic fill. */
const VIEW_FILTER_VALUES: Record<string, Record<string, string | number>> = {
  gateway_budget_ledger_events: { Status: "success", Scope: "project" },
  event_log: { EventOccurredAt: Date.now() },
};

const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "app_reader_identity_pg",
  host: "localhost",
  port: 5432,
  database: "langwatch",
  user: "reader",
  password: "unused",
};

const tenantColumnOf = new Map<string, string>(
  APP_READER_TENANT_TABLES.map(({ table, tenantColumn }) => [table, tenantColumn]),
);

interface MaterializedView {
  name: string;
  source: string;
  target: string;
}

/** Both readers' statements over one database; the LangWatchQL identity is not provisioned. */
function readersDdl({ sourceDatabase }: { sourceDatabase: string }): string[] {
  const names: LangWatchQLNames = {
    database: sourceDatabase,
    restrictedUser: "app_reader_identity_lwql",
    settingsProfile: "app_reader_identity_lwql_profile",
    keyMapTable: "lwql_api_key_tenant_map",
    tenantSetting: "custom_api_key_hash",
  };
  const shared = {
    names,
    passwordSha256Hex: "0".repeat(64),
    namedCollection: NAMED_COLLECTION,
    sourceDatabase,
  };
  const lwqlOnly = accessModelDefinition.renderDdl(accessModelDefinition.build(shared)).length;
  const definition = accessModelDefinition.build({
    ...shared,
    appReader: {
      passwordSha256Hex: sha256(READER_LOGIN),
      enforce: true,
      enforcing: { passwordSha256Hex: sha256(ENFORCING_LOGIN) },
    },
  });
  return accessModelDefinition.renderDdl(definition).slice(lwqlOnly);
}

async function rows<T>(
  client: ClickHouseClient,
  query: string,
  settings: Record<string, string | number> = {},
): Promise<T[]> {
  const result = await client.query({
    query,
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  return result.json<T>();
}

async function provision(admin: ClickHouseClient, sourceDatabase: string): Promise<void> {
  for (const statement of readersDdl({ sourceDatabase })) await admin.command({ query: statement });
}

async function dropReaders(admin: ClickHouseClient, databases: readonly string[]): Promise<void> {
  for (const user of [APP_READER_NAMES.user, ENFORCING_USER]) {
    await admin.command({ query: `DROP USER IF EXISTS ${user}` });
    await admin.command({ query: `DROP SETTINGS PROFILE IF EXISTS ${user}_profile` });
  }
  const policies = databases
    .flatMap((database) => readersDdl({ sourceDatabase: database }))
    .map((statement) => /^CREATE ROW POLICY OR REPLACE (\S+) ON (\S+)/.exec(statement))
    .filter((match) => match !== null);
  for (const [, name, table] of policies) {
    await admin.command({ query: `DROP ROW POLICY IF EXISTS ${name} ON ${table}` });
  }
}

async function materializedViews(
  admin: ClickHouseClient,
  database: string,
): Promise<MaterializedView[]> {
  const listed = await admin.query({
    query: `SELECT name, create_table_query FROM system.tables
             WHERE database = {database:String} AND engine = 'MaterializedView' ORDER BY name`,
    query_params: { database },
    format: "JSONEachRow",
  });
  const found = await listed.json<{ name: string; create_table_query: string }>();
  return found.map(({ name, create_table_query }) => ({
    name,
    source: new RegExp(`\\bFROM ${database}\\.\`?(\\w+)`).exec(create_table_query)?.[1] ?? "",
    target: new RegExp(`\\bTO ${database}\\.\`?(\\w+)`).exec(create_table_query)?.[1] ?? "",
  }));
}

/** The value a generic row gives one column: strings name it, times are now, the rest default. */
function fillFor(type: string, column: string, tenant: string): string | undefined {
  const inner = type
    .replace(/^(Nullable|LowCardinality)\(/, "")
    .replace(/^(Nullable|LowCardinality)\(/, "");
  const now = new Date().toISOString().replace("T", " ").replace("Z", "");
  if (inner.startsWith("String")) return `${column}_${tenant}`;
  if (inner.startsWith("DateTime")) return now;
  if (inner.startsWith("Date")) return now.slice(0, 10);
  return undefined;
}

async function rowFor({
  admin,
  database,
  source,
  tenant,
}: {
  admin: ClickHouseClient;
  database: string;
  source: string;
  tenant: string;
}): Promise<Record<string, string | number>> {
  const listed = await admin.query({
    query: `SELECT name, type FROM system.columns
             WHERE database = {database:String} AND table = {table:String}
               AND default_kind NOT IN ('MATERIALIZED', 'ALIAS')`,
    query_params: { database, table: source },
    format: "JSONEachRow",
  });
  const columns = await listed.json<{ name: string; type: string }>();
  const filled = columns
    .map(({ name, type }) => [name, fillFor(type, name, tenant)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
  return {
    ...Object.fromEntries(filled),
    ...VIEW_FILTER_VALUES[source],
    [tenantColumnOf.get(source) ?? "TenantId"]: tenant,
  };
}

/** One row per source as the system identity; the rows each view wrote for it. */
async function firePerView({
  admin,
  database,
  views,
  phase,
}: {
  admin: ClickHouseClient;
  database: string;
  views: readonly MaterializedView[];
  phase: string;
}): Promise<Record<string, number>> {
  const written: Record<string, number> = {};
  for (const source of new Set(views.map((view) => view.source))) {
    const tenant = `mv_${phase}_${source}_${randomBytes(3).toString("hex")}`;
    await admin.insert({
      table: `${database}.${source}`,
      values: [await rowFor({ admin, database, source, tenant })],
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    for (const view of views.filter((each) => each.source === source)) {
      const column = tenantColumnOf.get(view.target) ?? "TenantId";
      const [counted] = await rows<{ n: string }>(
        admin,
        `SELECT count() AS n FROM ${database}.${view.target} WHERE ${column} = '${tenant}'`,
      );
      written[view.name] = Number(counted?.n ?? 0);
    }
  }
  return written;
}

/** Statements carrying the marker: condition-cache hits and misses, and the setting. */
async function cacheUse(admin: ClickHouseClient, user: string, marker: string) {
  await admin.command({ query: "SYSTEM FLUSH LOGS" });
  const [use] = await rows<{ hits: string; misses: string; setting: string }>(
    admin,
    `SELECT sum(ProfileEvents['QueryConditionCacheHits']) AS hits,
            sum(ProfileEvents['QueryConditionCacheMisses']) AS misses,
            any(Settings['use_query_condition_cache']) AS setting
       FROM system.query_log
      WHERE user = '${user}' AND type = 'QueryFinish' AND position(query, '${marker}') > 0
        AND position(query, 'query_log') = 0`,
  );
  return { hits: Number(use?.hits ?? 0), misses: Number(use?.misses ?? 0), setting: use?.setting };
}

const SHAPES: Record<string, { clause: string; filter: string }> = {
  where: { clause: `WHERE ${CONDITION}`, filter: CONDITION },
  prewhere: { clause: `PREWHERE ${CONDITION}`, filter: CONDITION },
  "policy only": { clause: "", filter: "1" },
};
const ORDER = [TENANT_A, TENANT_B, TENANT_A, TENANT_B, TENANT_B, TENANT_A];

const cacheStatement = (shape: string, tag: string) =>
  `SELECT count() AS n, '${tag}' AS m FROM ${CACHE_DATABASE}.stored_spans ` +
  `${SHAPES[shape]?.clause ?? ""} GROUP BY m`;

/** Each tenant's rows per shape, counted by the system identity. */
async function cacheTruth(
  admin: ClickHouseClient,
): Promise<Record<string, Record<string, number>>> {
  const truth: Record<string, Record<string, number>> = {};
  for (const [shape, { filter }] of Object.entries(SHAPES)) {
    const perTenant: Record<string, number> = {};
    for (const tenant of [TENANT_A, TENANT_B]) {
      const [counted] = await rows<{ n: string }>(
        admin,
        `SELECT count() AS n FROM ${CACHE_DATABASE}.stored_spans ` +
          `WHERE TenantId = '${tenant}' AND ${filter}`,
      );
      perTenant[tenant] = Number(counted?.n ?? 0);
    }
    truth[shape] = perTenant;
  }
  return truth;
}

/** Spans over many 8-row granules, each tenant's apart, so a skipped granule loses rows. */
async function seedCacheTable(admin: ClickHouseClient): Promise<void> {
  await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${CACHE_DATABASE}` });
  await admin.command({
    query: `CREATE TABLE IF NOT EXISTS ${CACHE_DATABASE}.stored_spans
              (TenantId String, TraceId String, SpanId String)
            ENGINE = MergeTree ORDER BY (TenantId, TraceId, SpanId)
            SETTINGS index_granularity = 8`,
  });
  await admin.command({ query: `TRUNCATE TABLE ${CACHE_DATABASE}.stored_spans` });
  await admin.insert({
    table: `${CACHE_DATABASE}.stored_spans`,
    values: [TENANT_A, TENANT_B].flatMap((tenant) =>
      Array.from({ length: 400 }, (_, n) => ({ TenantId: tenant, TraceId: "t", SpanId: `s${n}` })),
    ),
    format: "JSONEachRow",
  });
}

/** Every shape in the interleaved tenant order, as the reader with the cache requested on. */
async function answersOf(
  reader: ClickHouseClient,
  marker: string,
): Promise<Record<string, [string, number][]>> {
  const answered: Record<string, [string, number][]> = {};
  for (const shape of Object.keys(SHAPES)) {
    const perShape: [string, number][] = [];
    for (const tenant of ORDER) {
      const [counted] = await rows<{ n: string }>(reader, cacheStatement(shape, marker), {
        [TENANT_SETTING]: tenant,
        use_query_condition_cache: 1,
      });
      perShape.push([tenant, Number(counted?.n ?? 0)]);
    }
    answered[shape] = perShape;
  }
  return answered;
}

describe("given ClickHouse 26.8 with the shipped migrations", () => {
  let harness: LangWatchQLClickHouseHarness | undefined;
  let admin: ClickHouseClient;
  let factDatabase: string;
  const opened: ClickHouseClient[] = [];

  function clientAs(user: string, password: string): ClickHouseClient {
    const url = new URL(harness?.container.getHttpUrl() ?? "");
    url.username = user;
    url.password = password;
    const client = createClient({ url: url.toString() });
    opened.push(client);
    return client;
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "app_reader_identity",
      facts: "migrated",
      settingsPrefixes: ["custom_", APP_READER_SETTINGS_PREFIX],
    });
    admin = harness.admin;
    factDatabase = harness.factDatabase;
  }, 300_000);

  afterAll(async () => {
    await Promise.all(opened.map((client) => client.close()));
    if (!admin) return;
    await dropReaders(admin, [factDatabase, CACHE_DATABASE]);
    await admin.command({ query: `DROP DATABASE IF EXISTS ${CACHE_DATABASE}` });
    await harness?.stop();
  });

  describe("when the system identity inserts before and after the readers' policies exist", () => {
    let views: MaterializedView[] = [];
    let before: Record<string, number> = {};
    let after: Record<string, number> = {};

    beforeAll(async () => {
      views = await materializedViews(admin, factDatabase);
      before = await firePerView({ admin, database: factDatabase, views, phase: "before" });
      await provision(admin, factDatabase);
      after = await firePerView({ admin, database: factDatabase, views, phase: "after" });
    }, 120_000);

    /** @scenario "Every materialised view fires on a system-identity insert once the readers' policies exist" */
    it("writes exactly what each view wrote before any reader policy existed", () => {
      expect(views.length).toBeGreaterThan(0);
      for (const view of views) expect(view.source && view.target, view.name).toBeTruthy();
      expect(after).toEqual(before);
      const fired = Object.values(before).filter((count) => count > 0);
      expect(fired.length, JSON.stringify(before)).toBe(views.length);
    });

    /** @scenario "Neither reader holds an INSERT grant" */
    it.each([
      ["the app reader", APP_READER_NAMES.user, READER_LOGIN],
      ["the enforcing reader", ENFORCING_USER, ENFORCING_LOGIN],
    ])("refuses an insert by %s", async (_who, user, login) => {
      await expect(
        clientAs(user, login).insert({
          table: `${factDatabase}.stored_spans`,
          values: [{ TenantId: TENANT_A }],
          format: "JSONEachRow",
          clickhouse_settings: { [TENANT_SETTING]: TENANT_A },
        }),
      ).rejects.toMatchObject({ code: ACCESS_DENIED });
    });
  });

  describe("when the reader leaves the query condition cache on", () => {
    let truth: Record<string, Record<string, number>> = {};

    beforeAll(async () => {
      await seedCacheTable(admin);
      await provision(admin, CACHE_DATABASE);
      truth = await cacheTruth(admin);
      await admin.command({ query: "SYSTEM DROP QUERY CONDITION CACHE" });
    }, 120_000);

    /** @scenario "The query condition cache never crosses tenants under the setting-keyed policy" */
    it("answers each tenant its own rows in every shape and order, with the cache consulted", async () => {
      const marker = `cache_${randomBytes(4).toString("hex")}`;
      const answered = await answersOf(clientAs(APP_READER_NAMES.user, READER_LOGIN), marker);
      const expected = Object.fromEntries(
        Object.keys(SHAPES).map((shape) => [
          shape,
          ORDER.map((tenant) => [tenant, truth[shape]?.[tenant] ?? -1]),
        ]),
      );
      const control = `${marker}_admin`;
      await rows(admin, cacheStatement("where", control), { use_query_condition_cache: 1 });
      await rows(admin, cacheStatement("where", control), { use_query_condition_cache: 1 });
      const readerUse = await cacheUse(admin, APP_READER_NAMES.user, marker);
      const adminUse = await cacheUse(admin, "test", control);
      const evidence = JSON.stringify({ readerUse, adminUse });

      expect(truth.where?.[TENANT_A]).toBeGreaterThan(0);
      expect(answered, evidence).toEqual(expected);
      expect(adminUse.hits, `the control never hit the cache: ${evidence}`).toBeGreaterThan(0);
      expect(readerUse.hits + readerUse.misses, `never consulted: ${evidence}`).toBeGreaterThan(0);
    });
  });
});
