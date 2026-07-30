import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { describe, expect, it } from "vitest";
import { mapTargetResult } from "./itemsMapping";
import { createExperimentRunItemsStore } from "./itemsStore";
import {
  experimentRunItemsColumnNames,
  experimentRunItemsColumns,
} from "./itemsTable";
import type { TargetResultData } from "./schema";

interface InsertCall {
  readonly tenantId: string;
  readonly table: string;
  readonly rows: unknown[][];
  readonly columns: readonly string[];
  readonly target: unknown;
}

function createFakeClient(): ClickHouseClient & {
  readonly insertCalls: InsertCall[];
} {
  const insertCalls: InsertCall[] = [];
  return {
    insertCalls,
    async query(): Promise<{ rows: unknown[][] }> {
      throw new Error("not used by an append store");
    },
    stream(): AsyncIterable<unknown[][]> {
      throw new Error("not used by an append store");
    },
    async insert(options) {
      insertCalls.push(options as InsertCall);
    },
    async close() {
      // Not exercised by an append store — nothing to release.
    },
  } satisfies ClickHouseClient & { insertCalls: InsertCall[] };
}

const targetData: TargetResultData = {
  runId: "run-1",
  experimentId: "exp-1",
  index: 0,
  targetId: "t1",
  entry: { q: 1 },
  cost: 0.05,
  occurredAt: 1_700_000_000_000,
};

describe("createExperimentRunItemsStore", () => {
  describe("given an empty batch", () => {
    it("writes nothing", async () => {
      const client = createFakeClient();
      const store = createExperimentRunItemsStore({ client });

      await store.writeBatch([], { tenantId: "tenant-1" });

      expect(client.insertCalls).toHaveLength(0);
    });
  });

  describe("given a non-empty batch", () => {
    it("inserts one batch with a retryable replacing target — ProjectionId carries per-record identity (ADR-104)", async () => {
      const client = createFakeClient();
      const store = createExperimentRunItemsStore({ client });
      const record = mapTargetResult({
        tenantId: "tenant-1",
        data: targetData,
      });

      await store.writeBatch([record], {
        tenantId: "tenant-1",
        retentionDays: 21,
      });

      expect(client.insertCalls).toHaveLength(1);
      const call = client.insertCalls[0]!;
      expect(call.table).toBe("experiment_run_items");
      expect(call.target).toEqual({ kind: "replacing" });
      expect(call.columns).toEqual(experimentRunItemsColumnNames);

      const decoded: Record<string, unknown> = {};
      experimentRunItemsColumnNames.forEach((name, i) => {
        decoded[name] = experimentRunItemsColumns[name].decode(
          call.rows[0]![i],
        );
      });
      expect(decoded.ProjectionId).toBe(record.projectionId);
      expect(decoded.RunId).toBe("run-1");
      expect(decoded.ExperimentId).toBe("exp-1");
      expect(decoded.TargetCost).toBe(0.05);
      expect(decoded._retention_days).toBe(21);
    });

    it("writes every record in one insert call, never one per record (ADR-099)", async () => {
      const client = createFakeClient();
      const store = createExperimentRunItemsStore({ client });
      const a = mapTargetResult({
        tenantId: "tenant-1",
        data: { ...targetData, targetId: "t1" },
      });
      const b = mapTargetResult({
        tenantId: "tenant-1",
        data: { ...targetData, targetId: "t2" },
      });

      await store.writeBatch([a, b], { tenantId: "tenant-1" });

      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]!.rows).toHaveLength(2);
    });

    it("falls back to the platform default retention when none is supplied", async () => {
      const client = createFakeClient();
      const store = createExperimentRunItemsStore({ client });
      const record = mapTargetResult({
        tenantId: "tenant-1",
        data: targetData,
      });

      await store.writeBatch([record], { tenantId: "tenant-1" });

      const call = client.insertCalls[0]!;
      const retentionIndex =
        experimentRunItemsColumnNames.indexOf("_retention_days");
      expect(
        experimentRunItemsColumns._retention_days.decode(
          call.rows[0]![retentionIndex],
        ),
      ).toBe(308);
    });
  });
});
