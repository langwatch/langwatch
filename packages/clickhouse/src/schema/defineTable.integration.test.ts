import { createClient, type ClickHouseClient as DriverClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foldStateTable } from "../__tests__/integration/fixtures";
import { readTestClickHouseInfo } from "../__tests__/integration/testClickHouse";

/**
 * `defineTable.describe()` is the drift check's whole point: a migration is
 * supposed to create exactly the engine, sort key, partition and TTL a table
 * declares, and nothing in the unit suite can prove that — a unit test only
 * proves `describe()` echoes back the object `defineTable` was called with. A
 * fake supplies whatever `system.tables` row the test wants; this file reads
 * the real one back after `globalSetup.ts` created `test_fold_state` from the
 * hand-written DDL in `fixtures.ts`, and fails if that DDL and the
 * declaration next to it (also in `fixtures.ts`) ever disagree.
 */
describe("given a table created from a defineTable declaration", () => {
  let client: DriverClient;

  beforeAll(() => {
    const { url } = readTestClickHouseInfo();
    client = createClient({ url });
  });

  afterAll(async () => {
    await client.close();
  });

  it("matches the declared merge engine, sort key, partition and TTL anchor", async () => {
    const description = foldStateTable.describe();

    const resultSet = await client.query({
      query: `SELECT engine_full, sorting_key, partition_key, create_table_query
              FROM system.tables
              WHERE database = currentDatabase() AND name = {name:String}`,
      query_params: { name: description.name },
      format: "JSONEachRow",
    });
    const [row] = await resultSet.json<{
      engine_full: string;
      sorting_key: string;
      partition_key: string;
      create_table_query: string;
    }>();
    expect(row).toBeDefined();

    expect(description.merge.kind).toBe("replacing");
    if (description.merge.kind === "replacing") {
      expect(row!.engine_full.startsWith(`ReplacingMergeTree(${description.merge.version})`)).toBe(
        true,
      );
    }

    expect(row!.sorting_key).toBe(description.sortKey.join(", "));
    expect(row!.partition_key).toBe(description.partition.by);

    expect(description.ttl).toBeDefined();
    expect(row!.create_table_query).toContain(`TTL ${description.ttl!.anchor}`);

    // The columns declared drive DDL cross-checking directly (ADR-099): every
    // declared column's ClickHouse type must appear, verbatim, in the DDL the
    // server actually stored.
    for (const name of description.columnNames) {
      const type = description.columnTypes[name]!;
      expect(row!.create_table_query).toContain(`\`${name}\` ${type}`);
    }
  });
});
