import { createClient, type ClickHouseClient as DriverClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readTestClickHouseInfo,
  uniqueId,
  uniqueTenant,
} from "../__tests__/integration/testClickHouse";
import { foldStateTable, type FoldState } from "../__tests__/integration/fixtures";
import { createClickHouseClient, type ClickHouseClient } from "../client/clickhouseClient";
import { createRowCodec } from "../codec/rowCodec";
import type { ColumnMap } from "../schema/columns";
import { createReplaceStore } from "./replaceStore";

const foldStateColumns = foldStateTable.columns as ColumnMap;

const EXPECTED_VERSION = "v1";

/**
 * Everything here runs against `test_fold_state`, created once by
 * `globalSetup.ts` from the DDL next to `foldStateTable`'s declaration in
 * `fixtures.ts`. Each test picks its own tenant and key
 * (`uniqueTenant`/`uniqueId`), so the tests below can run in any order, and
 * alongside every other file in the suite, without seeing each other's rows.
 */
describe("given createReplaceStore against a live ClickHouse", () => {
  let client: ClickHouseClient;
  // `OPTIMIZE TABLE ... FINAL` returns no result set, which the package's
  // own client (built for query/insert with a fixed read format) is not
  // shaped for — the raw driver runs administrative statements like this one
  // directly, the same way `fixtures.ts`'s DDL does.
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
    return createReplaceStore({
      client,
      table: foldStateTable,
      tenantIdColumn: "TenantId",
      keyColumn: "Key",
      stateColumn: "State",
      deliverySeqColumn: "DeliverySeq",
      stateVersionColumn: "StateVersion",
      expectedVersion: EXPECTED_VERSION,
    });
  }

  it("finds the exact state immediately after a write — read-your-writes", async () => {
    const store = buildStore();
    const tenantId = uniqueTenant();
    const key = uniqueId("key");

    await store.write(key, { state: { value: "v1" }, deliverySeq: 1, version: EXPECTED_VERSION }, {
      tenantId,
    });
    const result = await store.read(key, { tenantId });

    expect(result).toEqual({
      kind: "found",
      stored: { state: { value: "v1" }, deliverySeq: 1, version: EXPECTED_VERSION },
    });
  });

  it("does not advance the read state when the same delivery is written twice", async () => {
    const store = buildStore();
    const tenantId = uniqueTenant();
    const key = uniqueId("key");

    // First delivery of an event that computes state {value: "applied-once"}
    // at deliverySeq 5.
    await store.write(
      key,
      { state: { value: "applied-once" }, deliverySeq: 5, version: EXPECTED_VERSION },
      { tenantId },
    );
    const afterFirst = await store.read(key, { tenantId });

    // A retry redelivers the same event. Recomputing from the same input
    // produces the same output — this is what makes the redelivery safe, not
    // anything this store does — so it writes the identical state at the
    // identical deliverySeq.
    await store.write(
      key,
      { state: { value: "applied-once" }, deliverySeq: 5, version: EXPECTED_VERSION },
      { tenantId },
    );
    const afterRedelivery = await store.read(key, { tenantId });

    expect(afterRedelivery).toEqual(afterFirst);
    expect(afterRedelivery).toMatchObject({
      kind: "found",
      stored: { state: { value: "applied-once" }, deliverySeq: 5 },
    });
  });

  describe("given two versions of one row written directly to the table", () => {
    it("lets an undeduped read see both, a deduped read see only the newer, before and after a merge", async () => {
      const tenantId = uniqueTenant();
      const key = uniqueId("key");
      const store = buildStore();
      const codec = createRowCodec();
      const columns = foldStateTable.columnNames.map((name) => foldStateColumns[name]!);

      async function insertVersion(state: FoldState, writtenAt: Date): Promise<void> {
        const row = {
          TenantId: tenantId,
          Key: key,
          State: state,
          DeliverySeq: 1n,
          StateVersion: EXPECTED_VERSION,
          WrittenAt: writtenAt,
          AcceptedAt: writtenAt,
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

      async function undedupedStates(): Promise<string[]> {
        const result = await client.query({
          tenantId,
          sql: `SELECT State FROM ${foldStateTable.name}
                WHERE TenantId = {tenantId:String} AND Key = {key:String}`,
          params: { tenantId, key },
        });
        const decoded = codec.decodeRows<{ State: FoldState }>({
          columns: [foldStateColumns.State!],
          columnNames: ["State"],
          header: result.header,
          rows: result.rows,
        });
        return decoded.map((row) => row.State.value).sort();
      }

      // ClickHouse's own background merge scheduler is free to collapse two
      // small parts within milliseconds — nothing about a plain insert keeps
      // "before any merge" observable on a live server. `SYSTEM STOP MERGES`
      // makes that window deterministic instead of racing it.
      await driver.command({ query: `SYSTEM STOP MERGES ${foldStateTable.name}` });
      try {
        // Recent timestamps, not a fixed past date: `AcceptedAt` also anchors
        // the table's TTL (`TTL AcceptedAt + INTERVAL 30 DAY`), and TTL
        // expiry is enforced at merge time — a fixed date old enough to have
        // aged out would make `OPTIMIZE ... FINAL` below drop the row
        // entirely instead of merely deduping it.
        const olderAt = new Date();
        const newerAt = new Date(olderAt.getTime() + 1000);
        await insertVersion({ value: "older" }, olderAt);
        await insertVersion({ value: "newer" }, newerAt);

        expect(await undedupedStates()).toEqual(["newer", "older"]);

        const dedupedBeforeMerge = await store.read(key, { tenantId });
        expect(dedupedBeforeMerge).toMatchObject({
          kind: "found",
          stored: { state: { value: "newer" } },
        });

        await driver.command({ query: `SYSTEM START MERGES ${foldStateTable.name}` });
        await driver.command({ query: `OPTIMIZE TABLE ${foldStateTable.name} FINAL` });

        // The generated read is a point lookup ordered by version, not a scan
        // that depends on a merge having collapsed the parts — this assertion
        // is what proves that.
        const dedupedAfterMerge = await store.read(key, { tenantId });
        expect(dedupedAfterMerge).toEqual(dedupedBeforeMerge);

        // The merge did physically collapse the two rows into one, though —
        // the point of the assertion above is that the read did not need it to.
        expect(await undedupedStates()).toEqual(["newer"]);
      } finally {
        await driver.command({ query: `SYSTEM START MERGES ${foldStateTable.name}` });
      }
    });
  });
});
