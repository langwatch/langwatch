import { createClient, type ClickHouseClient as DriverClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendLogTable } from "../__tests__/integration/fixtures";
import { readTestClickHouseInfo, uniqueTenant } from "../__tests__/integration/testClickHouse";
import { createClickHouseClient, type ClickHouseClient } from "../client/clickhouseClient";
import { createAppendStore } from "./appendStore";

interface LogRecord {
  readonly acceptedAt: Date;
  readonly payload: string;
}

/**
 * Runs against `test_append_log`, created once by `globalSetup.ts`. It is
 * declared `append()` and backed by a plain `MergeTree` with no per-record
 * identity anywhere in its columns (see `fixtures.ts`) — the shape that never
 * collapses a duplicate row, which is exactly the fact this file's second
 * test rests on.
 */
describe("given createAppendStore against a live ClickHouse", () => {
  let client: ClickHouseClient;
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
    return createAppendStore<LogRecord, typeof appendLogTable.columns>({
      client,
      table: appendLogTable,
      toRow: (record, context) => ({
        TenantId: context.tenantId,
        AcceptedAt: record.acceptedAt,
        Payload: record.payload,
      }),
    });
  }

  async function countRows(tenantId: string): Promise<number> {
    const result = await client.query({
      tenantId,
      sql: `SELECT count() AS c FROM ${appendLogTable.name} WHERE TenantId = {tenantId:String}`,
      params: { tenantId },
      format: "JSONEachRow",
    });
    // JSONEachRow returns objects, not codec-shaped arrays — read directly
    // rather than through `WireCodec`, since count() is a scalar this test
    // has no declared column for.
    const [row] = result.rows as unknown as [{ c: string }];
    return Number(row.c);
  }

  it("makes a write visible to an immediate plain read — async_insert with wait_for_async_insert", async () => {
    const tenantId = uniqueTenant();
    const store = buildStore();

    await store.writeBatch([{ acceptedAt: new Date(), payload: "hello" }], { tenantId });

    // No FINAL, no sequential-consistency setting: `client.insert` only
    // resolves once `wait_for_async_insert` confirms the row is durable and
    // queryable (ADR-099, ADR-104 §6), so a plain, immediate read is enough.
    expect(await countRows(tenantId)).toBe(1);
  });

  it("keeps both rows of an exact duplicate write — no per-record identity to collapse on", async () => {
    const tenantId = uniqueTenant();
    const store = buildStore();
    const acceptedAt = new Date("2026-01-01T00:00:00.000Z");
    const record: LogRecord = { acceptedAt, payload: "duplicate" };

    await store.writeBatch([record], { tenantId });
    await store.writeBatch([record], { tenantId });

    // Force a merge — a plain `MergeTree` never collapses a duplicate row
    // regardless of merge state, unlike the `ReplacingMergeTree` in
    // `replaceStore.integration.test.ts`, so this assertion is meaningful
    // specifically because it runs after `OPTIMIZE ... FINAL`, not despite it.
    await driver.command({ query: `OPTIMIZE TABLE ${appendLogTable.name} FINAL` });

    expect(await countRows(tenantId)).toBe(2);
  });
});
