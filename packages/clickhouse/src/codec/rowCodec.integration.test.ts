import {
  createClient,
  type ClickHouseClient as DriverClient,
} from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  readTestClickHouseInfo,
  uniqueId,
} from "../__tests__/integration/testClickHouse";
import { ch } from "../schema/columns";
import {
  createRowCodec,
  type WireColumn,
  WireShapeMismatchError,
} from "./rowCodec";

/**
 * The codec's `WithNamesAndTypes` header check exists so a migration that
 * silently changes a column's type fails loudly at the first read instead of
 * decoding wrong (ADR-099). A fake transport supplies the header itself, so a
 * unit test can only prove the check runs against whatever header the test
 * wrote — it cannot prove ClickHouse's own header changes shape the way this
 * check assumes. This file owns a dedicated table it creates and drops
 * itself, rather than sharing `fixtures.ts`'s tables: it is the one test in
 * the suite that mutates a column's type mid-run, and a shared table would
 * leave that mutation for the next run to trip over.
 */
describe("given a live column type change", () => {
  let client: DriverClient;
  const tableName = uniqueId("test_codec_probe").replace(/-/g, "_");

  beforeAll(async () => {
    const { url } = readTestClickHouseInfo();
    client = createClient({ url });
    await client.command({
      query: `
        CREATE TABLE {table:Identifier}
        (
          TenantId String,
          AcceptedAt DateTime64(3),
          Value String
        )
        ENGINE = MergeTree
        PARTITION BY toYearWeek(AcceptedAt)
        ORDER BY (TenantId, AcceptedAt)
      `,
      query_params: { table: tableName },
    });
  });

  afterAll(async () => {
    await client.command({
      query: "DROP TABLE IF EXISTS {table:Identifier}",
      query_params: { table: tableName },
    });
    await client.close();
  });

  it("throws WireShapeMismatchError naming both types after the column's type changes", async () => {
    const tenantId = uniqueId("tenant");
    // A numeric string, so the MODIFY COLUMN below (String -> Int32) is a
    // valid cast of existing data rather than one this test has to work
    // around — the point is the codec's header check, not ClickHouse's
    // mutation semantics.
    await client.insert({
      table: tableName,
      values: [
        {
          TenantId: tenantId,
          AcceptedAt: "2026-01-01 00:00:00.000",
          Value: "42",
        },
      ],
      format: "JSONEachRow",
    });

    const stringColumn: WireColumn<string> = ch.string();
    const codec = createRowCodec();

    // Reading through the codec against the column's original type succeeds,
    // establishing the baseline the ALTER below is a change from.
    const before = await readOneRow({
      client,
      tableName,
      tenantId,
      codec,
      valueColumn: stringColumn,
    });
    expect(before).toEqual({ TenantId: tenantId, Value: "42" });

    // `mutations_sync: "1"` makes the ALTER block until the mutation
    // finishes on this replica, instead of the polling loop `system.mutations`
    // would otherwise need.
    await client.command({
      query: "ALTER TABLE {table:Identifier} MODIFY COLUMN Value Int32",
      query_params: { table: tableName },
      clickhouse_settings: { mutations_sync: "1" },
    });

    let caught: unknown;
    try {
      await readOneRow({
        client,
        tableName,
        tenantId,
        codec,
        valueColumn: stringColumn,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WireShapeMismatchError);
    expect((caught as Error).message).toContain("String");
    expect((caught as Error).message).toContain("Int32");
  });
});

async function readOneRow(args: {
  client: DriverClient;
  tableName: string;
  tenantId: string;
  codec: ReturnType<typeof createRowCodec>;
  valueColumn: WireColumn<string>;
}): Promise<Record<string, unknown>> {
  const resultSet = await args.client.query({
    query:
      "SELECT {tenantColumn:Identifier}, {valueColumn:Identifier} FROM {table:Identifier} " +
      "WHERE {tenantColumn:Identifier} = {tenantId:String}",
    query_params: {
      table: args.tableName,
      tenantColumn: "TenantId",
      valueColumn: "Value",
      tenantId: args.tenantId,
    },
    format: "JSONCompactEachRowWithNamesAndTypes",
  });
  const parsed = await resultSet.json<unknown[]>();
  const [names, types, ...rows] = parsed as [
    string[],
    string[],
    ...unknown[][],
  ];

  const [decoded] = args.codec.decodeRows<Record<string, unknown>>({
    columns: [ch.string(), args.valueColumn],
    columnNames: ["TenantId", "Value"],
    header: { names, types },
    rows,
  });
  if (!decoded) throw new Error("expected exactly one row");
  return decoded;
}
