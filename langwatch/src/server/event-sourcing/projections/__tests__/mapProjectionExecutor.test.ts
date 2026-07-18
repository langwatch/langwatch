import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockAppendStore,
  createMockMapProjectionDefinition,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { MapProjectionExecutor } from "../mapProjectionExecutor";
import type { ProjectionStoreContext } from "../projectionStoreContext";

describe("MapProjectionExecutor.execute", () => {
  const tenantId = createTestTenantId();
  let executor: MapProjectionExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    executor = new MapProjectionExecutor();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when map returns a record", () => {
    it("appends the record to the store and returns it", async () => {
      const store = createMockAppendStore<{ name: string }>();

      const mapDef = createMockMapProjectionDefinition("mapper", {
        store,
        map: (_event) => ({ name: "mapped-record" }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      const result = await executor.execute(mapDef, event, context);

      expect(result).toEqual({ name: "mapped-record" });
      expect(store.append).toHaveBeenCalledWith(
        { name: "mapped-record" },
        context,
      );
    });
  });

  describe("when map returns null", () => {
    it("does not call store.append and returns null", async () => {
      const store = createMockAppendStore<{ name: string }>();

      const mapDef = createMockMapProjectionDefinition("mapper", {
        store,
        map: (_event) => null,
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      const result = await executor.execute(mapDef, event, context);

      expect(result).toBeNull();
      expect(store.append).not.toHaveBeenCalled();
    });
  });

  describe("when map throws", () => {
    it("propagates the error", async () => {
      const store = createMockAppendStore<{ name: string }>();

      const mapDef = createMockMapProjectionDefinition("mapper", {
        store,
        map: (_event) => {
          throw new Error("map failed");
        },
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      await expect(executor.execute(mapDef, event, context)).rejects.toThrow(
        "map failed",
      );
    });
  });

  describe("when store.append throws", () => {
    it("propagates the error", async () => {
      const store = createMockAppendStore<{ name: string }>();
      (store.append as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("append failed"),
      );

      const mapDef = createMockMapProjectionDefinition("mapper", {
        store,
        map: (_event) => ({ name: "mapped-record" }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
      };

      await expect(executor.execute(mapDef, event, context)).rejects.toThrow(
        "append failed",
      );
    });
  });
});

describe("MapProjectionExecutor.executeBatch", () => {
  const tenantId = createTestTenantId();

  it("persists mapped records with one tenant-scoped bulk append", async () => {
    const executor = new MapProjectionExecutor();
    const store = createMockAppendStore<{ aggregateId: string }>();
    const bulkAppend = vi.fn(async () => undefined);
    store.bulkAppend = bulkAppend;
    const mapDef = createMockMapProjectionDefinition("mapper", {
      store,
      map: (event) => ({ aggregateId: String(event.aggregateId) }),
    });
    const events = ["one", "two"].map((aggregateId) =>
      createTestEvent(aggregateId, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
    );
    const contexts = events.map((event) => ({
      aggregateId: String(event.aggregateId),
      tenantId,
      retentionPolicy: { traces: 49, scenarios: 49, experiments: 49 },
    }));

    const result = await executor.executeBatch(mapDef, events, contexts);

    expect(result.map(({ record }) => record)).toEqual([
      { aggregateId: "one" },
      { aggregateId: "two" },
    ]);
    expect(bulkAppend).toHaveBeenCalledTimes(1);
    expect(bulkAppend).toHaveBeenCalledWith(
      [{ aggregateId: "one" }, { aggregateId: "two" }],
      {
        tenantId,
        retentionPolicy: { traces: 49, scenarios: 49, experiments: 49 },
      },
    );
    expect(store.append).not.toHaveBeenCalled();
  });

  describe("when the store has no bulkAppend", () => {
    it("refuses the batch instead of appending record by record", async () => {
      const executor = new MapProjectionExecutor();
      const store = createMockAppendStore<{ aggregateId: string }>();
      const mapDef = createMockMapProjectionDefinition("mapper", {
        store,
        map: (event) => ({ aggregateId: String(event.aggregateId) }),
      });
      const events = ["one", "two"].map((aggregateId) =>
        createTestEvent(aggregateId, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId),
      );
      const contexts = events.map((event) => ({
        aggregateId: String(event.aggregateId),
        tenantId,
        retentionPolicy: { traces: 49, scenarios: 49, experiments: 49 },
      }));

      await expect(
        executor.executeBatch(mapDef, events, contexts),
      ).rejects.toThrow(/no bulkAppend/);

      // The point of refusing: a sequential loop that committed "one" and then
      // threw on "two" would append "one" twice when the queue retried.
      expect(store.append).not.toHaveBeenCalled();
    });
  });

  describe("given a batch whose contexts span two tenants", () => {
    it("refuses to write it, rather than routing one tenant's rows under another's", async () => {
      // The guard existed but could never fire: the router built every context
      // by spreading the first one, so it compared a value with itself. A batch
      // that genuinely mixed tenants would have been bulk-appended under
      // whichever tenant happened to be first.
      const executor = new MapProjectionExecutor();
      const store = createMockAppendStore();
      store.bulkAppend = vi.fn(async () => {});
      const mapDef = createMockMapProjectionDefinition("mapper", {
        store,
        map: (_event) => ({ name: "mapped-record" }),
      });

      const tenantA = createTestTenantId();
      const tenantB = createTestTenantId("tenant-b");
      const events = [
        createTestEvent("agg-a", TEST_CONSTANTS.AGGREGATE_TYPE, tenantA),
        createTestEvent("agg-b", TEST_CONSTANTS.AGGREGATE_TYPE, tenantB),
      ];
      const contexts: ProjectionStoreContext[] = [
        { aggregateId: "agg-a", tenantId: tenantA },
        { aggregateId: "agg-b", tenantId: tenantB },
      ];

      await expect(
        executor.executeBatch(mapDef, events, contexts),
      ).rejects.toThrow(/cross tenants/i);
      expect(store.bulkAppend).not.toHaveBeenCalled();
    });
  });

});
