import {
  createClient,
  type ClickHouseClient as DriverClient,
} from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DRIFT_CASES,
  driftMismatchTable,
} from "../__tests__/integration/fixtures";
import { readTestClickHouseInfo } from "../__tests__/integration/testClickHouse";
import {
  assertNoDrift,
  type DeployedTableInfo,
  TableDriftError,
} from "./tableDrift";

/**
 * The one generic drift test: every `defineTable` declaration this package
 * registers in `DRIFT_CASES` (`fixtures.ts`) is checked against the same
 * live ClickHouse `globalSetup.ts` created it in — `system.tables` for the
 * engine, sort key and partition, `system.columns` for the column list in
 * physical order. Replaces the two hand-written per-table files this
 * subsumes (`defineTable.integration.test.ts`, `eventLog.integration.test.ts`
 * — deleted): they asserted the same four facts, by hand, once per table,
 * which is exactly the duplication ADR-099 exists to end. Adding a table to
 * `DRIFT_CASES` is now the entire cost of getting it checked here.
 *
 * `readTestClickHouseInfo()` throws if `globalSetup.ts` never ran — there is
 * no code path in which a missing ClickHouse (no native URL and no working
 * Docker for the `testcontainers` fallback) reaches this file at all; the
 * whole suite fails at `globalSetup`, loudly, before any `it` block runs.
 */

async function readDeployedTableInfo(
  client: DriverClient,
  name: string,
): Promise<DeployedTableInfo> {
  const tableResult = await client.query({
    query: `SELECT engine_full, sorting_key, partition_key, create_table_query
            FROM system.tables
            WHERE database = currentDatabase() AND name = {name:String}`,
    query_params: { name },
    format: "JSONEachRow",
  });
  const [tableRow] = await tableResult.json<{
    engine_full: string;
    sorting_key: string;
    partition_key: string;
    create_table_query: string;
  }>();
  if (!tableRow) {
    throw new Error(
      `table "${name}" does not exist in the test database — globalSetup.ts did not create it`,
    );
  }

  const columnsResult = await client.query({
    query: `SELECT name, type
            FROM system.columns
            WHERE database = currentDatabase() AND table = {name:String}
            ORDER BY position`,
    query_params: { name },
    format: "JSONEachRow",
  });
  const columns = await columnsResult.json<{ name: string; type: string }>();

  return {
    engineFull: tableRow.engine_full,
    sortingKey: tableRow.sorting_key,
    partitionKey: tableRow.partition_key,
    createTableQuery: tableRow.create_table_query,
    columns,
  };
}

describe("given a defineTable declaration and the live ClickHouse it was created in", () => {
  let client: DriverClient;

  beforeAll(() => {
    const { url } = readTestClickHouseInfo();
    client = createClient({ url });
  });

  afterAll(async () => {
    await client.close();
  });

  for (const driftCase of DRIFT_CASES) {
    /** @scenario every registered table's declaration matches the deployed engine, columns, sort key and partition */
    it(`"${driftCase.description.name}" matches the deployed engine, columns, sort key and partition`, async () => {
      const deployed = await readDeployedTableInfo(
        client,
        driftCase.description.name,
      );
      expect(() =>
        assertNoDrift(driftCase.description, deployed),
      ).not.toThrow();
    });
  }

  describe("given a declaration whose sort key deliberately disagrees with the DDL that created it", () => {
    /** @scenario a deliberately mismatched declaration is caught with a message naming the table and both sort keys */
    it("fails, naming the table and both sort keys", async () => {
      const deployed = await readDeployedTableInfo(
        client,
        driftMismatchTable.name,
      );

      let caught: unknown;
      try {
        assertNoDrift(driftMismatchTable.describe(), deployed);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TableDriftError);
      const error = caught as TableDriftError;
      expect(error.issues).toContain(
        'table "test_drift_mismatch": declared sort key (TenantId, Key) but the deployed sort key is (TenantId, WrittenAt)',
      );
    });
  });
});
