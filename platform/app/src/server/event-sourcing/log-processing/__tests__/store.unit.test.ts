import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeLogRequest } from "../canonicalize";
import type { CanonicalLogRecord } from "../schema";
import { createCanonicalLogStore } from "../store";

interface FakeClient extends ClickHouseClient {
  readonly insertCalls: Array<{
    table: string;
    rows: unknown[][];
    columns: readonly string[];
    target: unknown;
  }>;
}

function createFakeClient(): FakeClient {
  const insertCalls: FakeClient["insertCalls"] = [];
  return {
    insertCalls,
    async query(): Promise<{ rows: unknown[][] }> {
      throw new Error("not used by an append store");
    },
    stream(_options: QueryOptions) {
      throw new Error("not used by an append store");
    },
    async insert(options) {
      insertCalls.push({
        table: options.table,
        rows: options.rows,
        columns: options.columns,
        target: options.target,
      });
    },
    async close() {},
  };
}

async function fixtureRecords(): Promise<CanonicalLogRecord[]> {
  const result = await canonicalizeLogRequest({
    tenantId: "tenant-a",
    organizationId: "org-a",
    piiRedactionLevel: "DISABLED",
    redactionService: { redactLog: async () => undefined },
    acceptedAt: 1_700_000_000_000,
    request: {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: "test.scope" },
              logRecords: [
                { body: { stringValue: "one" } },
                { body: { stringValue: "two" } },
              ],
            },
          ],
        },
      ],
    } as any,
  });
  return result.accepted.map((p) => p.record);
}

describe("createCanonicalLogStore", () => {
  describe("given a non-empty batch", () => {
    it("writes both log_records and log_usage_estimates in one call", async () => {
      const client = createFakeClient();
      const store = createCanonicalLogStore({ client });
      const records = await fixtureRecords();

      await store.writeBatch(records, { tenantId: "tenant-a" });

      const tables = client.insertCalls.map((c) => c.table).sort();
      expect(tables).toEqual(["log_records", "log_usage_estimates"]);
      for (const call of client.insertCalls) {
        expect(call.rows).toHaveLength(2);
      }
    });

    it("carries the record id through to both tables, so a redelivery collapses in each", async () => {
      const client = createFakeClient();
      const store = createCanonicalLogStore({ client });
      const records = await fixtureRecords();

      await store.writeBatch(records, { tenantId: "tenant-a" });

      const logRecordsCall = client.insertCalls.find(
        (c) => c.table === "log_records",
      )!;
      const usageCall = client.insertCalls.find(
        (c) => c.table === "log_usage_estimates",
      )!;
      const recordIdIndexInLogRecords =
        logRecordsCall.columns.indexOf("RecordId");
      const recordIdIndexInUsage = usageCall.columns.indexOf("RecordId");
      expect(
        logRecordsCall.rows.map((row) => row[recordIdIndexInLogRecords]),
      ).toEqual(records.map((r) => r.recordId));
      expect(usageCall.rows.map((row) => row[recordIdIndexInUsage])).toEqual(
        records.map((r) => r.recordId),
      );
    });

    it("marks neither write with a per-record-identity append target — the conservative default an append() table gets", async () => {
      const client = createFakeClient();
      const store = createCanonicalLogStore({ client });
      const records = await fixtureRecords();

      await store.writeBatch(records, { tenantId: "tenant-a" });

      for (const call of client.insertCalls) {
        expect(call.target).toEqual({
          kind: "append",
          perRecordIdentity: false,
        });
      }
    });

    it("forwards the resolved retentionDays into the log_records row", async () => {
      const client = createFakeClient();
      const store = createCanonicalLogStore({ client });
      const records = await fixtureRecords();

      await store.writeBatch(records, {
        tenantId: "tenant-a",
        retentionDays: 45,
      });

      const logRecordsCall = client.insertCalls.find(
        (c) => c.table === "log_records",
      )!;
      const retentionIndex = logRecordsCall.columns.indexOf("_retention_days");
      expect(
        logRecordsCall.rows.every((row) => row[retentionIndex] === 45),
      ).toBe(true);
    });
  });

  describe("given a batch that has already been written once", () => {
    /** @scenario A redelivered batch collapses to one row per table, not two */
    it("issues the same plain insert again, relying on RecordId to collapse the duplicate", async () => {
      const client = createFakeClient();
      const store = createCanonicalLogStore({ client });
      const records = await fixtureRecords();

      await store.writeBatch(records, { tenantId: "tenant-a" });
      await store.writeBatch(records, { tenantId: "tenant-a" });

      // Nothing in this store deduplicates a redelivered batch itself — it is
      // not asked to remember what it already wrote, and it does not. Both
      // calls issue the same insert (one per table), and it is each row's own
      // RecordId — part of both tables' sort key — that the ClickHouse
      // ReplacingMergeTree engine uses to collapse the duplicate at merge
      // time. That collapse itself cannot be observed against a fake client;
      // it is the property `table.unit.test.ts` pins by asserting RecordId is
      // in the sort key of both tables.
      const insertsByTable = new Map<string, number>();
      for (const call of client.insertCalls) {
        insertsByTable.set(
          call.table,
          (insertsByTable.get(call.table) ?? 0) + 1,
        );
      }
      expect(insertsByTable.get("log_records")).toBe(2);
      expect(insertsByTable.get("log_usage_estimates")).toBe(2);

      const logRecordsCalls = client.insertCalls.filter(
        (c) => c.table === "log_records",
      );
      const recordIdIndex = logRecordsCalls[0]!.columns.indexOf("RecordId");
      expect(logRecordsCalls[0]!.rows.map((r) => r[recordIdIndex])).toEqual(
        logRecordsCalls[1]!.rows.map((r) => r[recordIdIndex]),
      );
    });
  });

  describe("given an empty batch", () => {
    it("issues no inserts at all", async () => {
      const client = createFakeClient();
      const store = createCanonicalLogStore({ client });

      await store.writeBatch([], { tenantId: "tenant-a" });

      expect(client.insertCalls).toHaveLength(0);
    });
  });

  describe("given one of the two underlying inserts fails", () => {
    it("propagates the failure rather than reporting a partial write as a success", async () => {
      const client = createFakeClient();
      const failingInsert = vi
        .spyOn(client, "insert")
        .mockImplementationOnce(async () => {
          throw new Error("log_records insert failed");
        });
      const store = createCanonicalLogStore({ client });
      const records = await fixtureRecords();

      await expect(
        store.writeBatch(records, { tenantId: "tenant-a" }),
      ).rejects.toThrow("log_records insert failed");
      failingInsert.mockRestore();
    });
  });
});
