import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSourcingService } from "../eventSourcingService";
import type { Event } from "../../domain/types";
import {
  createMockEventStore,
  createMockProjectionDefinition,
  createMockEventHandler,
  createMockProjectionStore,
  createMockDistributedLock,
  createTestEvent,
  createTestTenantId,
  createTestEventStoreReadContext,
  createTestAggregateType,
  createTestProjection,
  TEST_CONSTANTS,
} from "./testHelpers";

describe("EventSourcingService - Concurrency Flows", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();
  const context = createTestEventStoreReadContext(tenantId);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("distributed locking", () => {
    it("acquires lock before projection update", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(distributedLock.acquire).toHaveBeenCalledTimes(1);
      expect(distributedLock.acquire).toHaveBeenCalledBefore(
        projectionHandler.handle as ReturnType<typeof vi.fn>,
      );
    });

    it("lock key format is correct", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      const expectedLockKey = `update:${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}:projection`;
      expect(distributedLock.acquire).toHaveBeenCalledWith(
        expectedLockKey,
        expect.any(Number),
      );
    });

    it("lock TTL is used correctly", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const customTtl = 10 * 60 * 1000; // 10 minutes
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
        updateLockTtlMs: customTtl,
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(distributedLock.acquire).toHaveBeenCalledWith(
        expect.any(String),
        customTtl,
      );
    });

    it("lock is released after update (success)", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const lockHandle = { key: "test-key", value: "test-value" };
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );
      distributedLock.acquire = vi.fn().mockResolvedValue(lockHandle);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(distributedLock.release).toHaveBeenCalledTimes(1);
      expect(distributedLock.release).toHaveBeenCalledWith(lockHandle);
    });

    it("lock is released after update (failure)", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const lockHandle = { key: "test-key", value: "test-value" };
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      const handlerError = new Error("Handler failed");
      projectionHandler.handle = vi.fn().mockRejectedValue(handlerError);
      distributedLock.acquire = vi.fn().mockResolvedValue(lockHandle);

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("Handler failed");

      expect(distributedLock.release).toHaveBeenCalledTimes(1);
      expect(distributedLock.release).toHaveBeenCalledWith(lockHandle);
    });

    it("update is skipped when lock cannot be acquired", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      distributedLock.acquire = vi.fn().mockResolvedValue(null); // Lock not acquired

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
        logger: logger as any,
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/Cannot acquire lock for projection update/);
      expect(eventStore.getEvents).not.toHaveBeenCalled();
      expect(projectionHandler.handle).not.toHaveBeenCalled();
    });

    it("lock is released in finally block (even on error)", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const lockHandle = { key: "test-key", value: "test-value" };

      distributedLock.acquire = vi.fn().mockResolvedValue(lockHandle);
      eventStore.getEvents = vi
        .fn()
        .mockRejectedValue(new Error("EventStore failed"));

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow("EventStore failed");

      expect(distributedLock.release).toHaveBeenCalledTimes(1);
      expect(distributedLock.release).toHaveBeenCalledWith(lockHandle);
    });
  });

  describe("concurrent updates", () => {
    it("multiple concurrent updates to same aggregate are serialized", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      let lockAcquired = false;
      const lockHandle = { key: "test-key", value: "test-value" };

      distributedLock.acquire = vi.fn().mockImplementation(async () => {
        if (lockAcquired) {
          return null; // Second call returns null (lock already held)
        }
        lockAcquired = true;
        return lockHandle;
      });

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      // Simulate concurrent updates
      const update1 = service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );
      const update2 = service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      const results = await Promise.allSettled([update1, update2]);

      // One should succeed, one should be rejected with lock error
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter(
        (r) =>
          r.status === "rejected" &&
          r.reason instanceof Error &&
          r.reason.message.includes("Cannot acquire lock"),
      ).length;

      expect(succeeded).toBe(1);
      expect(failed).toBe(1);
    });

    it("different aggregates can update concurrently", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const aggregate1 = "aggregate-1";
      const aggregate2 = "aggregate-2";

      const lockHandles = new Map<string, { key: string; value: string }>();
      distributedLock.acquire = vi
        .fn()
        .mockImplementation(async (key: string) => {
          const handle = { key, value: `value-${key}` };
          lockHandles.set(key, handle);
          return handle;
        });

      eventStore.getEvents = vi
        .fn()
        .mockResolvedValue([createTestEvent(aggregate1, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)]);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(createTestProjection(aggregate1, tenantId));

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
      });

      // Update different aggregates concurrently
      const update1 = service.updateProjectionByName(
        "projection",
        aggregate1,
        context,
      );
      const update2 = service.updateProjectionByName(
        "projection",
        aggregate2,
        context,
      );

      await Promise.all([update1, update2]);

      // Both should succeed (different lock keys)
      expect(distributedLock.acquire).toHaveBeenCalledTimes(2);
      expect(projectionHandler.handle).toHaveBeenCalledTimes(2);
    });

    it("lock contention is handled gracefully (skip, don't block)", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      distributedLock.acquire = vi.fn().mockResolvedValue(null); // Lock not available

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
        logger: logger as any,
      });

      // Should throw error immediately, not block
      await expect(
        service.updateProjectionByName(
          "projection",
          TEST_CONSTANTS.AGGREGATE_ID,
          context,
        ),
      ).rejects.toThrow(/Cannot acquire lock for projection update/);
      expect(eventStore.getEvents).not.toHaveBeenCalled();
    });
  });

  describe("missing distributed lock", () => {
    it("service works without distributed lock", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        // No distributedLock provided
      });

      const result = await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(result).not.toBeNull();
      expect(projectionHandler.handle).toHaveBeenCalledTimes(1);
    });

    it("warning is logged in production when lock not provided", () => {
      const originalEnv = process.env.NODE_ENV;
      // @ts-expect-error - NODE_ENV is read-only in types but mutable at runtime for testing
      process.env.NODE_ENV = "production";

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const eventStore = createMockEventStore<Event>();

      new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        logger: logger as any,
        // No distributedLock provided
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType,
        }),
        expect.stringContaining("without distributed lock in production"),
      );

      // @ts-expect-error - NODE_ENV is read-only in types but mutable at runtime for testing
      process.env.NODE_ENV = originalEnv;
    });

    it("no warning in non-production when lock not provided", () => {
      const originalEnv = process.env.NODE_ENV;
      // @ts-expect-error - NODE_ENV is read-only in types but mutable at runtime for testing
      process.env.NODE_ENV = "development";

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        trace: vi.fn(),
        child: vi.fn().mockReturnThis(),
        level: "info",
        silent: false,
      };

      const eventStore = createMockEventStore<Event>();

      new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        logger: logger as any,
        // No distributedLock provided
      });

      expect(logger.warn).not.toHaveBeenCalled();

      // @ts-expect-error - NODE_ENV is read-only in types but mutable at runtime for testing
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe("lock TTL configuration", () => {
    it("custom TTL is used when provided", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const customTtl = 15 * 60 * 1000; // 15 minutes
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
        updateLockTtlMs: customTtl,
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(distributedLock.acquire).toHaveBeenCalledWith(
        expect.any(String),
        customTtl,
      );
    });

    it("default TTL is used when not provided", async () => {
      const eventStore = createMockEventStore<Event>();
      const projectionHandler = createMockEventHandler<Event, any>();
      const projectionStore = createMockProjectionStore<any>();
      const distributedLock = createMockDistributedLock();
      const events = [createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, TEST_CONSTANTS.AGGREGATE_TYPE, tenantId)];
      const DEFAULT_UPDATE_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

      eventStore.getEvents = vi.fn().mockResolvedValue(events);
      projectionHandler.handle = vi
        .fn()
        .mockResolvedValue(
          createTestProjection(TEST_CONSTANTS.AGGREGATE_ID, tenantId),
        );

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        projections: {
          projection: createMockProjectionDefinition(
            "projection",
            projectionHandler,
            projectionStore,
          ),
        },
        distributedLock,
        // updateLockTtlMs not provided
      });

      await service.updateProjectionByName(
        "projection",
        TEST_CONSTANTS.AGGREGATE_ID,
        context,
      );

      expect(distributedLock.acquire).toHaveBeenCalledWith(
        expect.any(String),
        DEFAULT_UPDATE_LOCK_TTL_MS,
      );
    });
  });
});
