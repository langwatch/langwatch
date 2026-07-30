import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foldStateTable } from "../__tests__/integration/fixtures";
import { readTestClickHouseInfo, uniqueId, uniqueTenant } from "../__tests__/integration/testClickHouse";
import { createClickHouseClient, type ClickHouseClient } from "../client/clickhouseClient";
import { createRowCodec } from "../codec/rowCodec";
import type { ColumnMap } from "./columns";

/**
 * `ch.uint64()` decodes to `bigint` specifically because the wire value does
 * not fit a JS `number` past 2^53 (ADR-099) — a fake transport can return
 * whatever string a test hands it, so it cannot prove the real driver's JSON
 * parsing round-trips a value that large without first coercing it through a
 * `number`. This exercises `test_fold_state`'s `DeliverySeq` column directly
 * through the client and codec, bypassing `replaceStore` — its
 * `StoredState.deliverySeq` contract is a plain `number` (ADR-098's
 * redelivery guard fits comfortably below 2^53), so this precision guarantee
 * has to be proven one layer down, at the column itself.
 */
describe("given ch.uint64() against a live ClickHouse", () => {
  let client: ClickHouseClient;

  beforeAll(() => {
    const { url } = readTestClickHouseInfo();
    client = createClickHouseClient({ url });
  });

  afterAll(async () => {
    await client.close();
  });

  it("round-trips a value above 2^53 exactly", async () => {
    const tenantId = uniqueTenant();
    const key = uniqueId("key");
    const codec = createRowCodec();
    const columns = foldStateTable.columns as ColumnMap;
    const wireColumns = foldStateTable.columnNames.map((name) => columns[name]!);

    const aboveDoublePrecision = 9_007_199_254_740_993n; // 2^53 + 1
    const now = new Date();
    const row = {
      TenantId: tenantId,
      Key: key,
      State: { value: "uint64-probe" },
      DeliverySeq: aboveDoublePrecision,
      StateVersion: "v1",
      WrittenAt: now,
      AcceptedAt: now,
    };

    await client.insert({
      tenantId,
      table: foldStateTable.name,
      rows: codec.encodeRows({ columns: wireColumns, columnNames: foldStateTable.columnNames, rows: [row] }),
      columns: foldStateTable.columnNames,
      target: { kind: "replacing" },
    });

    const result = await client.query({
      tenantId,
      sql: `SELECT DeliverySeq FROM ${foldStateTable.name}
            WHERE TenantId = {tenantId:String} AND Key = {key:String}`,
      params: { tenantId, key },
    });
    const [decoded] = codec.decodeRows<{ DeliverySeq: bigint }>({
      columns: [columns.DeliverySeq!],
      columnNames: ["DeliverySeq"],
      header: result.header,
      rows: result.rows,
    });

    expect(decoded).toBeDefined();
    expect(decoded!.DeliverySeq).toBe(aboveDoublePrecision);
    expect(typeof decoded!.DeliverySeq).toBe("bigint");
  });
});
