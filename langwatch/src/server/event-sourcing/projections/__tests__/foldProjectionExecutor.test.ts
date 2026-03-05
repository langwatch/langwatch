import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoldProjectionExecutor } from "../foldProjectionExecutor";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import type { Event } from "../../domain/types";

describe("FoldProjectionExecutor.execute", () => {
  const tenantId = createTestTenantId();
  let executor: FoldProjectionExecutor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
    executor = new FoldProjectionExecutor();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when no prior state exists", () => {
    it("initializes state and applies event", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
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

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 1 });
      expect(store.get).toHaveBeenCalledWith(TEST_CONSTANTS.AGGREGATE_ID, context);
      expect(store.store).toHaveBeenCalledWith({ count: 1 }, context);
    });
  });

  describe("when prior state exists", () => {
    it("loads existing state and applies event", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
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

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 6 });
      expect(store.store).toHaveBeenCalledWith({ count: 6 }, context);
    });
  });

  describe("when eventTypes is empty (all events)", () => {
    it("applies any event type", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
        eventTypes: [],
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

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 3 });
      expect(store.store).toHaveBeenCalledWith({ count: 3 }, context);
    });
  });

  describe("when event type does not match", () => {
    it("returns init state without loading or storing", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
        eventTypes: ["some.other.event"],
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

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 0 });
      expect(store.get).not.toHaveBeenCalled();
      expect(store.store).not.toHaveBeenCalled();
    });
  });

  describe("when custom key is provided in context", () => {
    it("uses the custom key for store.get", async () => {
      const store = createMockFoldProjectionStore<{ count: number }>();
      (store.get as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 10 });

      const foldDef = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, _event: Event) => ({
          count: state.count + 1,
        }),
      });

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        TEST_CONSTANTS.AGGREGATE_TYPE,
        tenantId,
      );

      const context: ProjectionStoreContext = {
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
        tenantId,
        key: "custom-key-123",
      };

      const result = await executor.execute(foldDef, event, context);

      expect(result).toEqual({ count: 11 });
      expect(store.get).toHaveBeenCalledWith("custom-key-123", context);
    });
  });
});
