import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { foldStateTable } from "../__tests__/integration/fixtures";
import { readTestClickHouseInfo, uniqueId, uniqueTenant } from "../__tests__/integration/testClickHouse";
import { createClickHouseClient, type ClickHouseClient } from "../client/clickhouseClient";
import { createRowCodec } from "../codec/rowCodec";
import { bindIdentifiers } from "../query/identifiers";
import type { ColumnMap } from "./columns";

/**
 * `ch.uint64()` decodes to `bigint` specifically because the wire value does
 * not fit a JS `number` past 2^53 (ADR-099) — a fake transport can return
 * whatever string a test hands it, so it cannot prove the real driver's JSON
 * parsing round-trips a value that large without first coercing it through a
 * `number`. This exercises `test_fold_state`'s `Count` column directly through
 * the client and codec, bypassing `clickhouseReplacing`: that fixture's fold
 * state declares `count` a `z.number()`, so the derived row mapping narrows the
 * column on the way back, and the precision guarantee has to be proven one
 * layer down, at the column itself.
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
      Value: "uint64-probe",
      Count: aboveDoublePrecision,
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

    const names = bindIdentifiers();
    const result = await client.query({
      tenantId,
      sql:
        `SELECT ${names.of("Count")} FROM ${names.of(foldStateTable.name)} ` +
        `WHERE ${names.of("TenantId")} = {tenantId:String} AND ${names.of("Key")} = {key:String}`,
      params: { ...names.params, tenantId, key },
    });
    const [decoded] = codec.decodeRows<{ Count: bigint }>({
      columns: [columns.Count!],
      columnNames: ["Count"],
      header: result.header,
      rows: result.rows,
    });

    expect(decoded).toBeDefined();
    expect(decoded!.Count).toBe(aboveDoublePrecision);
    expect(typeof decoded!.Count).toBe("bigint");
  });
});
