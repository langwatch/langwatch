import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapProjectionExecutor } from "../mapProjectionExecutor";
import {
  createMockAppendStore,
  createMockMapProjectionDefinition,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
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

      await expect(
        executor.execute(mapDef, event, context),
      ).rejects.toThrow("map failed");
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

      await expect(
        executor.execute(mapDef, event, context),
      ).rejects.toThrow("append failed");
    });
  });
});
