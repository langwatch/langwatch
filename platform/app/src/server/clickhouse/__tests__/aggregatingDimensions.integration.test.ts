import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The static guard (aggregatingDimensionGuard.unit.test.ts) reads the migration
 * files. This one reads the server, so a schema that drifts from the files —
 * a column added by an ALTER, a table an older install still carries — is
 * caught as well. ClickHouse 26 and newer reject a rollup column without a
 * merge rule at CREATE TABLE time, so a database that satisfies this test can
 * also be recreated from scratch on those versions.
 */
describe("given a ClickHouse database the migrations have run against", () => {
  let client: ClickHouseClient;
  let database: string;

  beforeAll(() => {
    const connectionUrl =
      process.env.CLICKHOUSE_URL ??
      "http://default:langwatch@localhost:8123/langwatch";
    database = new URL(connectionUrl).pathname.replace("/", "") || "langwatch";
    client = createClient({ url: connectionUrl });
  });

  afterAll(async () => {
    await client.close();
  });

  describe("when its AggregatingMergeTree tables are read from the server", () => {
    /** @scenario the migrated database carries the merge rule on every rollup column */
    it("has no column outside the sorting key that is not an aggregate state", async () => {
      const result = await client.query({
        query: `
        SELECT t.name AS table, c.name AS column, c.type AS type
        FROM system.tables AS t
        INNER JOIN system.columns AS c
          ON c.database = t.database AND c.table = t.name
        WHERE t.database = {database:String}
          AND t.engine LIKE '%AggregatingMergeTree%'
          AND c.type NOT LIKE 'AggregateFunction%'
          AND c.type NOT LIKE 'SimpleAggregateFunction%'
          AND c.default_kind NOT IN ('ALIAS', 'MATERIALIZED')
          AND NOT has(splitByString(', ', t.sorting_key), c.name)
        ORDER BY table, column
      `,
        query_params: { database },
        format: "JSONEachRow",
      });
      const dimensions = await result.json<{
        table: string;
        column: string;
        type: string;
      }>();

      expect(
        dimensions,
        "a merge collapses the rows sharing a sorting key and the survivor keeps an " +
          "arbitrary value of these columns; ClickHouse 26 and newer also reject the " +
          "CREATE TABLE, which stops a fresh install. Declare each one " +
          "SimpleAggregateFunction(max, <type>), or add it to ORDER BY.",
      ).toEqual([]);
    });

    it("merges by max on the four columns that were plain types", async () => {
      const expected = [
        {
          table: "evaluation_analytics_rollup",
          column: "_retention_days",
          type: "SimpleAggregateFunction(max, UInt16)",
        },
        {
          table: "gateway_budget_scope_totals",
          column: "UpdatedAt",
          type: "SimpleAggregateFunction(max, DateTime64(3))",
        },
        {
          table: "simulation_run_metrics_rollup",
          column: "PartitionMonth",
          type: "SimpleAggregateFunction(max, UInt32)",
        },
        {
          table: "trace_analytics_rollup",
          column: "_retention_days",
          type: "SimpleAggregateFunction(max, UInt16)",
        },
      ];

      const result = await client.query({
        query: `
        SELECT table, name AS column, type
        FROM system.columns
        WHERE database = {database:String}
          AND table IN ({tables:Array(String)})
          AND name IN ({columns:Array(String)})
        ORDER BY table, column
      `,
        query_params: {
          database,
          tables: expected.map(({ table }) => table),
          columns: expected.map(({ column }) => column),
        },
        format: "JSONEachRow",
      });

      expect(
        await result.json<{ table: string; column: string; type: string }>(),
      ).toEqual(expected);
    });
  });
});
