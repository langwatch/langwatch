/**
 * ADR-202 Decided 12 on a throwaway ClickHouse 26.8: the api's insert-only writer holds INSERT on
 * its three tables alone and may not read anything or insert anywhere else. The views its tables
 * feed run as their definer (Decided 16, migrations 00132 and 00133), so its inserts fill them.
 * @see specs/clickhouse/app-writer-identity.feature
 */
import { createHash, randomBytes } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  APP_READER_NAMES,
  APP_READER_SETTINGS_PREFIX,
  APP_READER_TENANT_TABLES,
  APP_WRITER_NAMES,
  APP_WRITER_TABLES,
  renderAppReaderDdl,
} from "@langwatch/clickhouse-migrations";
import { holdTestClickHouseServer } from "@langwatch/test-harness/clickhouse-server-lock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";

const READER_LOGIN = "app-writer-identity-reader-login";
const WRITER_LOGIN = "app-writer-identity-writer-login";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const ACCESS_DENIED = "497";
const HAVE_DEPENDENT_OBJECTS = "630";
const UNKNOWN_USER = "192";

/** Values a view's own filter requires, beside the generic fill. */
const VIEW_FILTER_VALUES: Record<string, Record<string, string | number>> = {
  gateway_budget_ledger_events: { Status: "success", Scope: "project" },
};

/** The two ways an api insert leaves: as one statement, and as the ledger's async insert. */
const INSERT_MODES: Record<string, Record<string, number | string>> = {
  sync: { date_time_input_format: "best_effort" },
  async: { date_time_input_format: "best_effort", async_insert: 1, wait_for_async_insert: 1 },
};

const tenantColumnOf = new Map<string, string>(
  APP_READER_TENANT_TABLES.map(({ table, tenantColumn }) => [table, tenantColumn]),
);

interface MaterializedView {
  name: string;
  source: string;
  target: string;
  /** `<definer>:<SQL SECURITY>` as the server reports it. */
  security: string;
}

/** The reader and the writer, as the upgrade renders them for a server LangWatchQL is off on. */
function identitiesDdl({ sourceDatabase }: { sourceDatabase: string }): string[] {
  return renderAppReaderDdl({
    sourceDatabase,
    appReader: { passwordSha256Hex: sha256(READER_LOGIN), enforce: true },
    appWriter: { passwordSha256Hex: sha256(WRITER_LOGIN) },
  });
}

async function count(admin: ClickHouseClient, query: string): Promise<number> {
  const result = await admin.query({ query, format: "JSONEachRow" });
  const [counted] = await result.json<{ n: string }>();
  return Number(counted?.n ?? 0);
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
    security: (/\bDEFINER = `?([^`\s]+)`? SQL SECURITY (\w+)/.exec(create_table_query) ?? [])
      .slice(1)
      .join(":"),
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
  table,
  tenant,
}: {
  admin: ClickHouseClient;
  database: string;
  table: string;
  tenant: string;
}): Promise<Record<string, string | number>> {
  const listed = await admin.query({
    query: `SELECT name, type FROM system.columns
             WHERE database = {database:String} AND table = {table:String}
               AND default_kind NOT IN ('MATERIALIZED', 'ALIAS')`,
    query_params: { database, table },
    format: "JSONEachRow",
  });
  const columns = await listed.json<{ name: string; type: string }>();
  const filled = columns
    .map(({ name, type }) => [name, fillFor(type, name, tenant)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
  return {
    ...Object.fromEntries(filled),
    ...VIEW_FILTER_VALUES[table],
    [tenantColumnOf.get(table) ?? "TenantId"]: tenant,
  };
}

describe("given ClickHouse 26.8 with the shipped migrations and the writer provisioned", () => {
  let harness: LangWatchQLClickHouseHarness | undefined;
  let admin: ClickHouseClient;
  let factDatabase: string;
  let writer: ClickHouseClient;
  const opened: ClickHouseClient[] = [];
  let release: (() => Promise<void>) | undefined;

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
      suite: "app_writer_identity",
      facts: "migrated",
      settingsPrefixes: ["custom_", APP_READER_SETTINGS_PREFIX],
    });
    // The reused container's reader is server-wide: no other file replaces or drops it mid-run.
    release = await holdTestClickHouseServer({ url: harness.container.getHttpUrl() });
    admin = harness.admin;
    factDatabase = harness.factDatabase;
    for (const statement of identitiesDdl({ sourceDatabase: factDatabase })) {
      await admin.command({ query: statement });
    }
    writer = clientAs(APP_WRITER_NAMES.user, WRITER_LOGIN);
  }, 300_000);

  afterAll(async () => {
    try {
      await Promise.all(opened.map((client) => client.close()));
      if (!admin) return;
      for (const user of [APP_READER_NAMES.user, APP_WRITER_NAMES.user]) {
        await admin.command({ query: `DROP USER IF EXISTS ${user}` });
        await admin.command({ query: `DROP SETTINGS PROFILE IF EXISTS ${user}_profile` });
      }
      const policies = identitiesDdl({ sourceDatabase: factDatabase })
        .map((statement) => /^CREATE ROW POLICY OR REPLACE (\S+) ON (\S+)/.exec(statement))
        .filter((match) => match !== null);
      for (const [, name, table] of policies) {
        await admin.command({ query: `DROP ROW POLICY IF EXISTS ${name} ON ${table}` });
      }
      // A reused container keeps the facts database; the next run migrates its views afresh.
      await admin.command({ query: `DROP DATABASE IF EXISTS ${factDatabase}` });
      await harness?.stop();
    } finally {
      await release?.();
    }
  });

  describe("when the writer inserts into instant_eval_runs, which feeds no view", () => {
    /** @scenario "The writer's insert into a table that feeds no view is stored" */
    it.each(Object.entries(INSERT_MODES))("stores the row (%s)", async (mode, settings) => {
      const table = "instant_eval_runs";
      const tenant = `writer_${mode}_${randomBytes(3).toString("hex")}`;
      await writer.insert({
        table: `${factDatabase}.${table}`,
        values: [await rowFor({ admin, database: factDatabase, table, tenant })],
        format: "JSONEachRow",
        clickhouse_settings: settings,
      });
      expect(
        await count(
          admin,
          `SELECT count() AS n FROM ${factDatabase}.${table} WHERE TenantId = '${tenant}'`,
        ),
      ).toBe(1);
    });
  });

  describe("when the writer inserts into a table that feeds a view", () => {
    let views: MaterializedView[] = [];

    beforeAll(async () => {
      const writerTables = new Set(APP_WRITER_TABLES);
      views = (await materializedViews(admin, factDatabase)).filter((view) =>
        writerTables.has(view.source),
      );
    });

    /** @scenario "The writer's insert fills every view its table feeds" */
    it("runs every such view as its definer, the migrating user", async () => {
      expect(views.map((view) => view.name).toSorted()).toEqual([
        "dspy_steps_id_index_mv",
        "gateway_budget_ledger_events_id_index_mv",
        "gateway_budget_scope_totals_mv",
      ]);
      const [migrator] = await (
        await admin.query({ query: "SELECT currentUser() AS user", format: "JSONEachRow" })
      ).json<{ user: string }>();
      for (const view of views) {
        expect(view.security, view.name).toBe(`${migrator?.user}:DEFINER`);
      }
    });

    /** @scenario "The writer's insert fills every view its table feeds" */
    it.each(Object.entries(INSERT_MODES))(
      "stores the row and fills each view (%s)",
      async (mode, settings) => {
        for (const source of new Set(views.map((view) => view.source))) {
          const tenant = `writer_view_${mode}_${randomBytes(3).toString("hex")}`;
          await writer.insert({
            table: `${factDatabase}.${source}`,
            values: [await rowFor({ admin, database: factDatabase, table: source, tenant })],
            format: "JSONEachRow",
            clickhouse_settings: settings,
          });
          const column = tenantColumnOf.get(source) ?? "TenantId";
          expect(
            await count(
              admin,
              `SELECT count() AS n FROM ${factDatabase}.${source} WHERE ${column} = '${tenant}'`,
            ),
            source,
          ).toBe(1);
          for (const view of views.filter((each) => each.source === source)) {
            const target = tenantColumnOf.get(view.target) ?? "TenantId";
            expect(
              await count(
                admin,
                `SELECT count() AS n FROM ${factDatabase}.${view.target} WHERE ${target} = '${tenant}'`,
              ),
              view.name,
            ).toBeGreaterThan(0);
          }
        }
      },
    );

    describe("and the view's definer is a user holding no grant", () => {
      const view = () => `${factDatabase}.dspy_steps_id_index_mv`;
      const definer = `app_writer_bare_definer_${randomBytes(3).toString("hex")}`;

      beforeAll(async () => {
        await admin.command({ query: `CREATE USER ${definer} IDENTIFIED WITH no_password` });
        await admin.command({
          query: `ALTER TABLE ${view()} MODIFY SQL SECURITY DEFINER DEFINER = ${definer}`,
        });
      });

      afterAll(async () => {
        await admin.command({
          query: `ALTER TABLE ${view()} MODIFY SQL SECURITY DEFINER DEFINER = CURRENT_USER`,
        });
        await admin.command({ query: `DROP USER IF EXISTS ${definer}` });
        await admin.command({ query: `DROP USER IF EXISTS ${definer}_renamed` });
      });

      /** @scenario "ClickHouse refuses to drop a user a view runs as" */
      it("refuses to drop the definer, naming the view", async () => {
        await expect(admin.command({ query: `DROP USER ${definer}` })).rejects.toMatchObject({
          code: HAVE_DEPENDENT_OBJECTS,
        });
      });

      async function insertDspyStep(tenant: string) {
        return writer.insert({
          table: `${factDatabase}.dspy_steps`,
          values: [await rowFor({ admin, database: factDatabase, table: "dspy_steps", tenant })],
          format: "JSONEachRow",
          clickhouse_settings: INSERT_MODES.sync,
        });
      }

      const storedSteps = (tenant: string) =>
        count(
          admin,
          `SELECT count() AS n FROM ${factDatabase}.dspy_steps WHERE TenantId = '${tenant}'`,
        );

      /** @scenario "A definer without the grants fails the writer's insert by code" */
      it("refuses the writer's insert and stores nothing", async () => {
        const tenant = `writer_bare_${randomBytes(3).toString("hex")}`;
        await expect(insertDspyStep(tenant)).rejects.toMatchObject({ code: ACCESS_DENIED });
        expect(await storedSteps(tenant)).toBe(0);
      });

      /** @scenario "A definer renamed away fails the writer's insert by code" */
      it("refuses the writer's insert once the definer is renamed, and stores nothing", async () => {
        await admin.command({ query: `ALTER USER ${definer} RENAME TO ${definer}_renamed` });
        const tenant = `writer_renamed_${randomBytes(3).toString("hex")}`;
        await expect(insertDspyStep(tenant)).rejects.toMatchObject({ code: UNKNOWN_USER });
        expect(await storedSteps(tenant)).toBe(0);
      });
    });
  });

  describe("when the writer selects", () => {
    /** @scenario "The writer may not read, even the tables it inserts into" */
    it.each([["dspy_steps"], ["gateway_budget_ledger_events"], ["system.query_log"]])(
      "refuses a select from %s",
      async (table) => {
        const name = table.includes(".") ? table : `${factDatabase}.${table}`;
        await expect(
          writer.query({ query: `SELECT count() FROM ${name}`, format: "JSONEachRow" }),
        ).rejects.toMatchObject({ code: ACCESS_DENIED });
      },
    );

    /** @scenario "The writer may not read, even the tables it inserts into" */
    it("sees no row of its own query log", async () => {
      const result = await writer.query({
        query: "SELECT count() AS n FROM system.user_query_log",
        format: "JSONEachRow",
      });
      const [counted] = await result.json<{ n: string }>();
      expect(Number(counted?.n ?? 0)).toBe(0);
    });
  });

  describe("when the writer inserts into a table outside its three", () => {
    /** @scenario "The writer may not insert into any other table" */
    it("refuses the insert", async () => {
      await expect(
        writer.insert({
          table: `${factDatabase}.stored_spans`,
          values: [{ TenantId: "project_a" }],
          format: "JSONEachRow",
        }),
      ).rejects.toMatchObject({ code: ACCESS_DENIED });
    });
  });
});
