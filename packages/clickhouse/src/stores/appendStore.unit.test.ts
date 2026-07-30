import { describe, expect, it } from "vitest";
import type {
  ClickHouseClient,
  QueryOptions,
} from "../client/clickhouseClient";
import { ch } from "../schema/columns";
import { aggregating, append, defineTable, replacing } from "../schema/defineTable";
import { AppendStoreConfigurationError, createAppendStore } from "./appendStore";

interface SpanRecord {
  readonly spanId: string;
  readonly durationMs: number;
}

const spansTable = defineTable({
  name: "spans",
  merge: append(),
  sortKey: ["TenantId", "AcceptedAt", "SpanId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    SpanId: ch.string(),
    DurationMs: ch.uint64(),
  },
});

const idempotencyKeyedSpansTable = defineTable({
  name: "spans_keyed",
  merge: replacing({ version: "WrittenAt" }),
  sortKey: ["TenantId", "AcceptedAt", "SpanId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
  tenant: ["TenantId"],
  columns: {
    TenantId: ch.string(),
    AcceptedAt: ch.acceptedAt(),
    SpanId: ch.string(),
    DurationMs: ch.uint64(),
    WrittenAt: ch.writtenAt(),
  },
});

interface FakeClient extends ClickHouseClient {
  readonly insertCalls: Array<{
    tenantId: string;
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
      throw new Error("not used by appendStore");
    },
    stream(_options: QueryOptions) {
      throw new Error("not used by appendStore");
    },
    async insert(options) {
      insertCalls.push(options as FakeClient["insertCalls"][number]);
    },
    async close() {},
  };
}

function toSpanRow(record: SpanRecord, context: { tenantId: string }) {
  return {
    TenantId: context.tenantId,
    AcceptedAt: new Date("2026-07-01T00:00:00.000Z"),
    SpanId: record.spanId,
    DurationMs: BigInt(record.durationMs),
  };
}

describe("given createAppendStore()", () => {
  describe("when the table declares an aggregating merge strategy", () => {
    it("throws at construction rather than at the first write", () => {
      const rollupTable = defineTable({
        name: "rollup",
        merge: aggregating({ idempotency: "upstream-exactly-once" }),
        sortKey: ["TenantId", "AcceptedAt"],
        partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt" },
        tenant: ["TenantId"],
        columns: {
          TenantId: ch.string(),
          AcceptedAt: ch.acceptedAt(),
          Total: ch.float64(),
        },
      });

      expect(() =>
        createAppendStore<{ total: number }, typeof rollupTable.columns>({
          client: createFakeClient(),
          table: rollupTable,
          toRow: (record, context) => ({
            TenantId: context.tenantId,
            AcceptedAt: new Date(),
            Total: record.total,
          }),
        }),
      ).toThrow(AppendStoreConfigurationError);
    });
  });

  describe("when writing a non-empty batch to a plain append() table", () => {
    it("issues exactly one insert for the whole batch, marked not retry-safe", async () => {
      const client = createFakeClient();
      const store = createAppendStore<SpanRecord, typeof spansTable.columns>({
        client,
        table: spansTable,
        toRow: toSpanRow,
      });

      await store.writeBatch(
        [
          { spanId: "span-1", durationMs: 10 },
          { spanId: "span-2", durationMs: 20 },
          { spanId: "span-3", durationMs: 30 },
        ],
        { tenantId: "tenant-a" },
      );

      expect(client.insertCalls).toHaveLength(1);
      const call = client.insertCalls[0]!;
      expect(call.table).toBe("spans");
      expect(call.rows).toHaveLength(3);
      expect(call.target).toEqual({ kind: "append", perRecordIdentity: false });
    });

    it("carries every record's own values, in the order given", async () => {
      const client = createFakeClient();
      const store = createAppendStore<SpanRecord, typeof spansTable.columns>({
        client,
        table: spansTable,
        toRow: toSpanRow,
      });

      await store.writeBatch(
        [
          { spanId: "span-1", durationMs: 10 },
          { spanId: "span-2", durationMs: 20 },
        ],
        { tenantId: "tenant-a" },
      );

      const call = client.insertCalls[0]!;
      const spanIdIndex = call.columns.indexOf("SpanId");
      const durationIndex = call.columns.indexOf("DurationMs");
      expect(call.rows.map((row) => row[spanIdIndex])).toEqual(["span-1", "span-2"]);
      expect(call.rows.map((row) => row[durationIndex])).toEqual(["10", "20"]);
    });
  });

  describe("when writing a batch to a replacing table keyed per record", () => {
    it("marks the write retry-safe, since a duplicate collapses at merge", async () => {
      const client = createFakeClient();
      const store = createAppendStore<SpanRecord, typeof idempotencyKeyedSpansTable.columns>({
        client,
        table: idempotencyKeyedSpansTable,
        toRow: (record, context) => ({
          ...toSpanRow(record, context),
          WrittenAt: new Date(),
        }),
      });

      await store.writeBatch([{ spanId: "span-1", durationMs: 10 }], { tenantId: "tenant-a" });

      expect(client.insertCalls[0]?.target).toEqual({ kind: "replacing" });
    });
  });

  describe("when writeBatch is called with an empty array", () => {
    it("skips the insert entirely", async () => {
      const client = createFakeClient();
      const store = createAppendStore<SpanRecord, typeof spansTable.columns>({
        client,
        table: spansTable,
        toRow: toSpanRow,
      });

      await store.writeBatch([], { tenantId: "tenant-a" });

      expect(client.insertCalls).toHaveLength(0);
    });
  });

  describe("when the underlying client insert fails", () => {
    it("propagates the failure to the caller", async () => {
      const failingClient: FakeClient = {
        ...createFakeClient(),
        async insert() {
          throw new Error("insert failed");
        },
      };
      const store = createAppendStore<SpanRecord, typeof spansTable.columns>({
        client: failingClient,
        table: spansTable,
        toRow: toSpanRow,
      });

      await expect(
        store.writeBatch([{ spanId: "span-1", durationMs: 10 }], { tenantId: "tenant-a" }),
      ).rejects.toThrow("insert failed");
    });
  });
});
