import { describe, expect, it, vi } from "vitest";
import { createMapExecutor } from "./mapExecutor";
import type {
  AppendStore,
  BatchContext,
  MergeStore,
} from "./store.types";
import type { Metrics } from "../ports/metrics";

interface TestEvent {
  readonly id: string;
}

interface TestRecord {
  readonly eventId: string;
}

function appendStore(): AppendStore<TestRecord> & {
  writeBatch: ReturnType<typeof vi.fn>;
} {
  return {
    kind: "append",
    writeBatch: vi.fn(async () => undefined),
  };
}

function mergeStore(): MergeStore<TestRecord> & {
  writeBatch: ReturnType<typeof vi.fn>;
} {
  return {
    kind: "merge",
    idempotency: "whole-bucket-replace",
    writeBatch: vi.fn(async () => undefined),
  };
}

function fakeMetrics(): Metrics & {
  incCalls: Array<{ name: string; labels?: Record<string, string> }>;
  observeCalls: Array<{
    name: string;
    value: number;
    labels?: Record<string, string>;
  }>;
} {
  const incCalls: Array<{ name: string; labels?: Record<string, string> }> =
    [];
  const observeCalls: Array<{
    name: string;
    value: number;
    labels?: Record<string, string>;
  }> = [];
  return {
    incCalls,
    observeCalls,
    counter: (spec) => ({
      inc: (labels, value = 1) => {
        void value;
        incCalls.push({ name: spec.name, labels });
      },
    }),
    histogram: (spec) => ({
      observe: (value, labels) => {
        observeCalls.push({ name: spec.name, value, labels });
      },
    }),
  };
}

describe("createMapExecutor", () => {
  describe("given events that each map to one record", () => {
    it("flattens the delivery into a single writeBatch call", async () => {
      const store = appendStore();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => ({ eventId: event.id }),
        projectionName: "spanStorage",
      });

      const result = await executor.apply({
        tenantId: "tenant-1",
        events: [{ id: "e1" }, { id: "e2" }, { id: "e3" }],
      });

      expect(store.writeBatch).toHaveBeenCalledTimes(1);
      expect(store.writeBatch).toHaveBeenCalledWith(
        [{ eventId: "e1" }, { eventId: "e2" }, { eventId: "e3" }],
        { tenantId: "tenant-1", retentionDays: undefined },
      );
      expect(result).toEqual({ written: 3 });
    });
  });

  describe("given a map that returns null for some events", () => {
    it("drops the null contributions from the batch", async () => {
      const store = appendStore();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => (event.id === "skip" ? null : { eventId: event.id }),
        projectionName: "spanStorage",
      });

      const result = await executor.apply({
        tenantId: "tenant-1",
        events: [{ id: "e1" }, { id: "skip" }, { id: "e2" }],
      });

      expect(store.writeBatch).toHaveBeenCalledWith(
        [{ eventId: "e1" }, { eventId: "e2" }],
        expect.anything(),
      );
      expect(result).toEqual({ written: 2 });
    });
  });

  describe("given a map that returns an array for one event", () => {
    it("contributes each element of the array to the batch", async () => {
      const store = appendStore();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => [
          { eventId: `${event.id}-a` },
          { eventId: `${event.id}-b` },
        ],
        projectionName: "spanStorage",
      });

      const result = await executor.apply({
        tenantId: "tenant-1",
        events: [{ id: "e1" }],
      });

      expect(store.writeBatch).toHaveBeenCalledWith(
        [{ eventId: "e1-a" }, { eventId: "e1-b" }],
        expect.anything(),
      );
      expect(result).toEqual({ written: 2 });
    });
  });

  describe("given a delivery whose events all map to null", () => {
    it("writes nothing and does not call writeBatch", async () => {
      const store = appendStore();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: () => null,
        projectionName: "spanStorage",
      });

      const result = await executor.apply({
        tenantId: "tenant-1",
        events: [{ id: "e1" }, { id: "e2" }],
      });

      expect(store.writeBatch).not.toHaveBeenCalled();
      expect(result).toEqual({ written: 0 });
    });
  });

  describe("given a store whose writeBatch rejects", () => {
    it("propagates the failure to the caller", async () => {
      const store = appendStore();
      store.writeBatch.mockRejectedValueOnce(new Error("column store down"));
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => ({ eventId: event.id }),
        projectionName: "spanStorage",
      });

      await expect(
        executor.apply({ tenantId: "tenant-1", events: [{ id: "e1" }] }),
      ).rejects.toThrow("column store down");
    });
  });

  describe("given an append store", () => {
    it("labels its write metric with storeKind append", async () => {
      const store = appendStore();
      const metrics = fakeMetrics();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => ({ eventId: event.id }),
        projectionName: "spanStorage",
        metrics,
      });

      await executor.apply({ tenantId: "tenant-1", events: [{ id: "e1" }] });

      expect(metrics.incCalls).toContainEqual({
        name: "es_map_write_batch_total",
        labels: {
          projection: "spanStorage",
          storeKind: "append",
          outcome: "written",
        },
      });
    });
  });

  describe("given a merge store", () => {
    it("labels its write metric with storeKind merge, making it visible to operations", async () => {
      const store = mergeStore();
      const metrics = fakeMetrics();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => ({ eventId: event.id }),
        projectionName: "traceAnalyticsRollup",
        metrics,
      });

      await executor.apply({ tenantId: "tenant-1", events: [{ id: "e1" }] });

      expect(store.writeBatch).toHaveBeenCalledTimes(1);
      expect(metrics.incCalls).toContainEqual({
        name: "es_map_write_batch_total",
        labels: {
          projection: "traceAnalyticsRollup",
          storeKind: "merge",
          outcome: "written",
        },
      });
    });
  });

  describe("given a store whose writeBatch rejects, with metrics wired", () => {
    /** @scenario a failing projection is visible on the same metric as a succeeding one */
    it("counts the failed attempt rather than counting nothing at all", async () => {
      const store = appendStore();
      store.writeBatch.mockRejectedValueOnce(new Error("column store down"));
      const metrics = fakeMetrics();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => ({ eventId: event.id }),
        projectionName: "spanStorage",
        metrics,
      });

      await expect(
        executor.apply({ tenantId: "tenant-1", events: [{ id: "e1" }] }),
      ).rejects.toThrow("column store down");

      // The point is the denominator: without this the counter never moves on a
      // failure, so a projection whose store is down reads as one that simply
      // stopped receiving work.
      expect(metrics.incCalls).toEqual([
        {
          name: "es_map_write_batch_total",
          labels: {
            projection: "spanStorage",
            storeKind: "append",
            outcome: "failed",
          },
        },
      ]);
      expect(metrics.observeCalls).toEqual([]);
    });
  });

  describe("given a delivery with a retentionDays value", () => {
    it("forwards retentionDays to the store's batch context", async () => {
      const store = appendStore();
      const executor = createMapExecutor<TestEvent, TestRecord>({
        store,
        map: (event) => ({ eventId: event.id }),
        projectionName: "spanStorage",
      });

      await executor.apply({
        tenantId: "tenant-1",
        events: [{ id: "e1" }],
        retentionDays: 30,
      });

      const call = store.writeBatch.mock.calls[0] as
        | [TestRecord[], BatchContext]
        | undefined;
      expect(call?.[1]).toEqual({ tenantId: "tenant-1", retentionDays: 30 });
    });
  });
});
