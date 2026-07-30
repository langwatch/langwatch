import {
  createClient,
  type ClickHouseClient as DriverClient,
} from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FOLD_STATE_SCHEMA,
  type FoldState,
  foldStateTable,
} from "../__tests__/integration/fixtures";
import {
  readTestClickHouseInfo,
  uniqueId,
  uniqueTenant,
} from "../__tests__/integration/testClickHouse";
import {
  type ClickHouseClient,
  createClickHouseClient,
} from "../client/clickhouseClient";
import { createRowCodec } from "../codec/rowCodec";
import { bindIdentifiers } from "../query/identifiers";
import type { ColumnMap } from "../schema/columns";
import { clickhouseReplacing } from "./replaceStore";

const foldStateColumns = foldStateTable.columns as ColumnMap;

const EXPECTED_VERSION = "v1";

/**
 * Everything here runs against `test_fold_state`, created once by
 * `globalSetup.ts` from the DDL next to `foldStateTable`'s declaration in
 * `fixtures.ts`. Each test picks its own tenant and key
 * (`uniqueTenant`/`uniqueId`), so the tests below can run in any order, and
 * alongside every other file in the suite, without seeing each other's rows.
 */
describe("given clickhouseReplacing against a live ClickHouse", () => {
  let client: ClickHouseClient;
  // `OPTIMIZE TABLE ... FINAL` returns no result set, which the package's
  // own client (built for query/insert with a fixed read format) is not
  // shaped for — the raw driver runs administrative statements like this one
  // directly, binding the table name as a query parameter all the same.
  let driver: DriverClient;

  beforeAll(() => {
    const { url } = readTestClickHouseInfo();
    client = createClickHouseClient({ url });
    driver = createClient({ url });
  });

  afterAll(async () => {
    await client.close();
    await driver.close();
  });

  function buildStore() {
    return clickhouseReplacing<FoldState, typeof foldStateTable.columns>({
      client,
      table: foldStateTable,
      version: EXPECTED_VERSION,
      key: "Key",
      stateVersionColumn: "StateVersion",
      state: FOLD_STATE_SCHEMA,
    });
  }

  function commandOnFoldState(statement: string): Promise<unknown> {
    return driver.command({
      query: statement,
      query_params: { table: foldStateTable.name },
    });
  }

  /** @scenario a record written under the current shape is recovered as written */
  it("finds the exact state immediately after a write — read-your-writes", async () => {
    const store = buildStore();
    const tenantId = uniqueTenant();
    const key = uniqueId("key");
    const state: FoldState = {
      value: "first",
      count: 1,
      acceptedAt: Date.now(),
    };

    await store.write(key, { state, version: EXPECTED_VERSION }, { tenantId });
    const result = await store.read(key, { tenantId });

    expect(result).toEqual({
      kind: "found",
      stored: { state, version: EXPECTED_VERSION },
    });
  });

  it("reads back the same state when the same delivery is written twice", async () => {
    const store = buildStore();
    const tenantId = uniqueTenant();
    const key = uniqueId("key");

    // A fold is a function of the SET of its events, so a redelivery
    // recomputes the identical state and writes it again. There is no
    // sequence column to skip on — that is what makes the redelivery safe.
    const stored = {
      state: { value: "applied-once", count: 5, acceptedAt: Date.now() },
      version: EXPECTED_VERSION,
    };
    await store.write(key, stored, { tenantId });
    const afterFirst = await store.read(key, { tenantId });

    await store.write(key, stored, { tenantId });
    const afterRedelivery = await store.read(key, { tenantId });

    expect(afterRedelivery).toEqual(afterFirst);
    expect(afterRedelivery).toEqual({ kind: "found", stored });
  });

  describe("given two versions of one row written directly to the table", () => {
    it("lets an undeduped read see both, a deduped read see only the newer, before and after a merge", async () => {
      const tenantId = uniqueTenant();
      const key = uniqueId("key");
      const store = buildStore();
      const codec = createRowCodec();
      const columns = foldStateTable.columnNames.map(
        (name) => foldStateColumns[name]!,
      );

      async function insertVersion(
        state: FoldState,
        writtenAt: Date,
      ): Promise<void> {
        const row = {
          TenantId: tenantId,
          Key: key,
          Value: state.value,
          Count: BigInt(state.count),
          StateVersion: EXPECTED_VERSION,
          WrittenAt: writtenAt,
          AcceptedAt: new Date(state.acceptedAt),
        };
        const rows = codec.encodeRows({
          columns,
          columnNames: foldStateTable.columnNames,
          rows: [row],
        });
        await client.insert({
          tenantId,
          table: foldStateTable.name,
          rows,
          columns: foldStateTable.columnNames,
          target: { kind: "replacing" },
        });
      }

      async function undedupedValues(): Promise<string[]> {
        const names = bindIdentifiers();
        const result = await client.query({
          tenantId,
          sql:
            `SELECT ${names.of("Value")} FROM ${names.of(foldStateTable.name)} ` +
            `WHERE ${names.of("TenantId")} = {tenantId:String} AND ${names.of("Key")} = {key:String}`,
          params: { ...names.params, tenantId, key },
        });
        const decoded = codec.decodeRows<{ Value: string }>({
          columns: [foldStateColumns.Value!],
          columnNames: ["Value"],
          header: result.header,
          rows: result.rows,
        });
        return decoded.map((row) => row.Value).sort();
      }

      // ClickHouse's own background merge scheduler is free to collapse two
      // small parts within milliseconds — nothing about a plain insert keeps
      // "before any merge" observable on a live server. `SYSTEM STOP MERGES`
      // makes that window deterministic instead of racing it.
      await commandOnFoldState("SYSTEM STOP MERGES {table:Identifier}");
      try {
        // Recent timestamps, not a fixed past date: `AcceptedAt` also anchors
        // the table's TTL (`TTL AcceptedAt + INTERVAL 30 DAY`), and TTL
        // expiry is enforced at merge time — a fixed date old enough to have
        // aged out would make `OPTIMIZE ... FINAL` below drop the row
        // entirely instead of merely deduping it.
        const olderAt = new Date();
        const newerAt = new Date(olderAt.getTime() + 1000);
        const acceptedAt = olderAt.getTime();
        await insertVersion({ value: "older", count: 1, acceptedAt }, olderAt);
        const newer: FoldState = { value: "newer", count: 2, acceptedAt };
        await insertVersion(newer, newerAt);

        expect(await undedupedValues()).toEqual(["newer", "older"]);

        const dedupedBeforeMerge = await store.read(key, { tenantId });
        expect(dedupedBeforeMerge).toEqual({
          kind: "found",
          stored: { state: newer, version: EXPECTED_VERSION },
        });

        await commandOnFoldState("SYSTEM START MERGES {table:Identifier}");
        await commandOnFoldState("OPTIMIZE TABLE {table:Identifier} FINAL");

        // The generated read is a point lookup ordered by version, not a scan
        // that depends on a merge having collapsed the parts — this assertion
        // is what proves that.
        const dedupedAfterMerge = await store.read(key, { tenantId });
        expect(dedupedAfterMerge).toEqual(dedupedBeforeMerge);

        // The merge did physically collapse the two rows into one, though —
        // the point of the assertion above is that the read did not need it to.
        expect(await undedupedValues()).toEqual(["newer"]);
      } finally {
        await commandOnFoldState("SYSTEM START MERGES {table:Identifier}");
      }
    });
  });
});
