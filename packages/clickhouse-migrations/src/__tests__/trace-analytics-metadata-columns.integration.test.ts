/**
 * @vitest-environment node
 * Goose 00126's nine trace_analytics metadata columns on a real server: its mutation fills rows
 * written before it, insert fills the rest. @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseMigrateTask } from "../clickhouse-migrate.task.ts";

const MIGRATION = resolve(
  import.meta.dirname,
  "../../migrations/00126_trace_analytics_metadata_columns.sql",
);

/** Each column and the `Attributes` key it is computed from. */
const COLUMNS: Record<string, string> = {
  MetadataOutputAction: "metadata.output_action",
  MetadataOutcome: "metadata.outcome",
  MetadataSentToReview: "metadata.sent_to_review",
  MetadataDocumentType: "metadata.document_type",
  MetadataFlow: "metadata.flow",
  MetadataLanguage: "metadata.language",
  MetadataSegment: "metadata.segment",
  MetadataTeam: "metadata.team",
  MetadataTopic: "metadata.topic",
};
const NAMES = Object.keys(COLUMNS);

const TENANT = `metadata-columns-${randomUUID()}`;
const SCRATCH = `trace_analytics_before_00126_${process.pid}`;
/** Today, so the table's retention TTL never drops the rows mid-test. */
const OCCURRED_AT = new Date().toISOString().slice(0, 23).replace("T", " ");

/** Every key carried, each with its own value, beside a key no column reads. */
const FULL = {
  ...Object.fromEntries(Object.values(COLUMNS).map((key) => [key, `${key}-value`])),
  "metadata.other": "ignored",
};
const BARE = { "metadata.other": "ignored" };

/** Where the goose file names trace_analytics, before ENVSUB fills in the database. */
const SOURCE_TABLE = /\$\{CLICKHOUSE_DATABASE\}\.trace_analytics\b/g;

const row = (traceId: string, attributes: Record<string, string>) => ({
  TenantId: TENANT,
  TraceId: traceId,
  Version: "1",
  OccurredAt: OCCURRED_AT,
  CreatedAt: OCCURRED_AT,
  UpdatedAt: OCCURRED_AT,
  Attributes: attributes,
});

/** The Up statements of the shipped migration, aimed at `table` instead of trace_analytics. */
function upStatements({ database, table }: { database: string; table: string }): string[] {
  const [up = ""] = readFileSync(MIGRATION, "utf8").split("-- +goose Down");
  return [...up.matchAll(/-- \+goose StatementBegin\n([\s\S]*?)-- \+goose StatementEnd/g)].map(
    ([, statement = ""]) => statement.replaceAll(SOURCE_TABLE, `${database}.${table}`),
  );
}

describe("given trace_analytics rows with and without the nine metadata keys", () => {
  let client: ClickHouseClient;
  let database: string;

  /** The nine columns of each of the tenant's rows in `table`, by trace id. */
  async function metadataOf(table: string): Promise<Record<string, Record<string, string>>> {
    const result = await client.query({
      query: `SELECT TraceId, ${NAMES.join(", ")} FROM ${table} WHERE TenantId = {tenant:String}`,
      query_params: { tenant: TENANT },
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, string>>();
    return Object.fromEntries(
      rows.map(({ TraceId, ...columns }) => [String(TraceId), columns as Record<string, string>]),
    );
  }

  const expected = (attributes: Record<string, string>) =>
    Object.fromEntries(NAMES.map((name) => [name, attributes[COLUMNS[name] ?? ""] ?? ""]));

  beforeAll(async () => {
    const [provisioned] = await startTestClickHouseEndpoints({
      suite: "clickhouse-client-migrated",
      names: ["schema"],
      environment: process.env,
    });
    if (!provisioned) throw new Error("No ClickHouse endpoint was provisioned for the suite");

    await migrateTestClickHouseOnce({
      url: provisioned.url,
      migrate: async () => {
        await ClickHouseMigrateTask.createFromConfig({
          config: { buildTime: false, sharedUrl: provisioned.url, privateEndpoints: [] },
        }).execute();
      },
    });

    database = provisioned.database;
    client = createClient({
      url: provisioned.url,
      clickhouse_settings: DEFAULT_CLICKHOUSE_SETTINGS,
    });
  }, 180_000);

  afterAll(async () => {
    await client?.command({ query: `DROP TABLE IF EXISTS ${SCRATCH}` });
    await client?.command({
      query: "ALTER TABLE trace_analytics DELETE WHERE TenantId = {tenant:String}",
      query_params: { tenant: TENANT },
    });
    await client?.close();
  });

  describe("when the rows were written before 00126 and its statements then ran", () => {
    /** @scenario "The migration fills the metadata columns for existing rows" */
    it("stores each key's value in its column, and empty text for a missing key", async () => {
      // trace_analytics as it stood before 00126: the shipped table less the nine columns.
      await client.command({ query: `DROP TABLE IF EXISTS ${SCRATCH}` });
      await client.command({ query: `CREATE TABLE ${SCRATCH} AS trace_analytics` });
      await client.command({
        query: `ALTER TABLE ${SCRATCH} ${NAMES.map((name) => `DROP COLUMN ${name}`).join(", ")}`,
      });
      await client.insert({
        table: SCRATCH,
        format: "JSONEachRow",
        values: [row("full", FULL), row("bare", BARE)],
      });

      const statements = upStatements({ database, table: SCRATCH });
      expect(statements).toHaveLength(10);
      for (const statement of statements) {
        expect(statement).not.toMatch(/\$\{/);
        await client.command({ query: statement });
      }
      await mutationsDone({ client, database, table: SCRATCH });

      const stored = await client.query({
        query: `SELECT DISTINCT column FROM system.parts_columns
          WHERE database = {database:String} AND table = {table:String} AND active`,
        query_params: { database, table: SCRATCH },
        format: "JSONEachRow",
      });
      const columns = (await stored.json<{ column: string }>()).map(({ column }) => column);
      expect(columns).toEqual(expect.arrayContaining(NAMES));

      expect(await metadataOf(SCRATCH)).toEqual({ full: expected(FULL), bare: expected(BARE) });
    });
  });

  describe("when the rows are written after 00126", () => {
    /** @scenario "The migration fills the metadata columns for existing rows" */
    it("computes each column from the row's own Attributes on insert", async () => {
      await client.insert({
        table: "trace_analytics",
        format: "JSONEachRow",
        values: [row("full", FULL), row("bare", BARE)],
      });

      expect(await metadataOf("trace_analytics")).toEqual({
        full: expected(FULL),
        bare: expected(BARE),
      });
    });
  });
});

/** Waits for every mutation on `table` to finish, failing on the first reported failure. */
async function mutationsDone({
  client,
  database,
  table,
}: {
  client: ClickHouseClient;
  database: string;
  table: string;
}): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const result = await client.query({
      query: `SELECT countIf(NOT is_done) AS pending,
          anyIf(latest_fail_reason, latest_fail_reason != '') AS failure
        FROM system.mutations
        WHERE database = {database:String} AND table = {table:String}`,
      query_params: { database, table },
      format: "JSONEachRow",
    });
    const [state] = await result.json<{ pending: string; failure: string }>();
    expect(state?.failure ?? "", "the mutation failed").toBe("");
    if (Number(state?.pending) === 0) return;
    if (Date.now() >= deadline) throw new Error(`mutations on ${table} still pending after 60s`);
    await sleep(250);
  }
}
