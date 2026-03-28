import { describe, expect, it, vi } from "vitest";
import { FoldReplayService } from "../foldReplayService";
import type { EventRecord, EventRepository } from "../../stores/repositories/eventRepository.types";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../foldProjection.types";
import type { Event } from "../../domain/types";

interface TestState {
  count: number;
  items: string[];
  CreatedAt: number;
  UpdatedAt: number;
}

function createMockEventRepository(records: EventRecord[]): EventRepository {
  return {
    getEventRecords: vi.fn().mockResolvedValue(records),
    getEventRecordsUpTo: vi.fn(),
    countEventRecords: vi.fn(),
    insertEventRecords: vi.fn(),
  };
}

function createMockInnerStore(): FoldProjectionStore<TestState> & { storeCalls: TestState[] } {
  const storeCalls: TestState[] = [];
  return {
    storeCalls,
    get: vi.fn().mockResolvedValue(null),
    store: vi.fn(async (state: TestState) => { storeCalls.push(state); }),
  };
}

function createMockProjection(): FoldProjectionDefinition<TestState, Event> {
  return {
    name: "testFold",
    version: "2026-03-28",
    eventTypes: ["test.item_added"],

    init: () => ({
      count: 0,
      items: [],
      CreatedAt: Date.now(),
      UpdatedAt: Date.now(),
    }),

    apply: (state: TestState, event: Event): TestState => ({
      ...state,
      count: state.count + 1,
      items: [...state.items, (event.data as any).item],
      UpdatedAt: Math.max(event.occurredAt, state.UpdatedAt + 1),
    }),

    store: { get: vi.fn(), store: vi.fn() },
  };
}

function createMockRedis() {
  return {
    set: vi.fn().mockResolvedValue("OK"),
  };
}

function createEventRecord(index: number, item: string): EventRecord {
  return {
    TenantId: "tenant-1",
    AggregateType: "test",
    AggregateId: "agg-1",
    EventId: `event-${index}`,
    EventTimestamp: 1000 + index * 100,
    EventOccurredAt: 1000 + index * 100,
    EventType: "test.item_added",
    EventVersion: "2026-03-28",
    EventPayload: { item },
    ProcessingTraceparent: "",
    IdempotencyKey: `key-${index}`,
  };
}

describe("FoldReplayService", () => {
  describe("when replaying an aggregate", () => {
    it("reads all events, folds from init, writes final state to inner store", async () => {
      const records = [
        createEventRecord(1, "alpha"),
        createEventRecord(2, "beta"),
        createEventRecord(3, "gamma"),
      ];
      const eventRepo = createMockEventRepository(records);
      const innerStore = createMockInnerStore();
      const projection = createMockProjection();
      const redis = createMockRedis();
      const service = new FoldReplayService(eventRepo, redis as any);

      const result = await service.replay({
        projection,
        innerStore,
        request: { aggregateId: "agg-1", aggregateType: "test", tenantId: "tenant-1" },
        redisKeyPrefix: "test_table",
      });

      expect(result.count).toBe(3);
      expect(result.items).toEqual(["alpha", "beta", "gamma"]);
      expect(innerStore.storeCalls).toHaveLength(1);
      expect(innerStore.storeCalls[0]!.count).toBe(3);
      expect(eventRepo.getEventRecords).toHaveBeenCalledWith("tenant-1", "test", "agg-1");
    });
  });

  describe("when event log is empty", () => {
    it("writes init state to inner store", async () => {
      const eventRepo = createMockEventRepository([]);
      const innerStore = createMockInnerStore();
      const projection = createMockProjection();
      const redis = createMockRedis();
      const service = new FoldReplayService(eventRepo, redis as any);

      const result = await service.replay({
        projection,
        innerStore,
        request: { aggregateId: "agg-1", aggregateType: "test", tenantId: "tenant-1" },
        redisKeyPrefix: "test_table",
      });

      expect(result.count).toBe(0);
      expect(result.items).toEqual([]);
      expect(innerStore.storeCalls).toHaveLength(1);
    });
  });

  describe("when inner store write fails during replay", () => {
    it("propagates the error", async () => {
      const records = [createEventRecord(1, "alpha")];
      const eventRepo = createMockEventRepository(records);
      const innerStore = createMockInnerStore();
      (innerStore.store as any).mockRejectedValueOnce(new Error("CH down"));
      const projection = createMockProjection();
      const redis = createMockRedis();
      const service = new FoldReplayService(eventRepo, redis as any);

      await expect(
        service.replay({
          projection,
          innerStore,
          request: { aggregateId: "agg-1", aggregateType: "test", tenantId: "tenant-1" },
          redisKeyPrefix: "test_table",
        }),
      ).rejects.toThrow("CH down");
    });
  });

  describe("when replay succeeds", () => {
    it("caches the result in Redis", async () => {
      const records = [createEventRecord(1, "alpha")];
      const eventRepo = createMockEventRepository(records);
      const innerStore = createMockInnerStore();
      const projection = createMockProjection();
      const redis = createMockRedis();
      const service = new FoldReplayService(eventRepo, redis as any);

      await service.replay({
        projection,
        innerStore,
        request: { aggregateId: "agg-1", aggregateType: "test", tenantId: "tenant-1" },
        redisKeyPrefix: "test_table",
        ttlSeconds: 30,
      });

      expect(redis.set).toHaveBeenCalledWith(
        "fold:test_table:agg-1",
        expect.any(String),
        "EX",
        30,
      );
    });
  });
});
