import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import type { JobRegistryEntry } from "../queueManager";
import { QueueManager } from "../queueManager";

function createMockSharedQueue(): EventSourcedQueueProcessor<any> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

describe("QueueManager.initializeReactorQueues with hierarchical group keys", () => {
  const aggregateType = createTestAggregateType();
  const tenantId = createTestTenantId();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when reactor has fold parent", () => {
    it("includes parent fold name in hierarchical group key", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        {
          evaluationTrigger: {
            name: "evaluationTrigger",
            parentProjection: "traceSummary",
            parentType: "fold" as const,
            handler: { handle: vi.fn().mockResolvedValue(void 0) },
          },
        },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:reactor:evaluationTrigger");
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const groupKey = entry?.groupKeyFn({ event, foldState: {} });
      expect(groupKey).toBe(
        `${tenantId}/fold/traceSummary/reactor/evaluationTrigger/${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });

  describe("when reactor has map parent", () => {
    it("includes parent map name in hierarchical group key", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        {
          spanStorageBroadcast: {
            name: "spanStorageBroadcast",
            parentProjection: "spanStorage",
            parentType: "map" as const,
            handler: { handle: vi.fn().mockResolvedValue(void 0) },
          },
        },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:reactor:spanStorageBroadcast");
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      const groupKey = entry?.groupKeyFn({ event, foldState: {} });
      expect(groupKey).toBe(
        `${tenantId}/map/spanStorage/reactor/spanStorageBroadcast/${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });

  describe("when reactor has custom groupKeyFn", () => {
    it("uses custom groupKeyFn for domain part of hierarchical key", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const customGroupKeyFn = (payload: { event: Event; foldState: unknown }) =>
        `custom:${(payload.event as any).data?.runId}`;

      manager.initializeReactorQueues(
        {
          customReactor: {
            name: "customReactor",
            parentProjection: "traceSummary",
            parentType: "fold" as const,
            handler: { handle: vi.fn().mockResolvedValue(void 0) },
            groupKeyFn: customGroupKeyFn,
          },
        },
        vi.fn(),
      );

      const entry = globalJobRegistry.get("test-pipeline:reactor:customReactor");
      const event = {
        ...createTestEvent(TEST_CONSTANTS.AGGREGATE_ID, aggregateType, tenantId),
        data: { runId: "run-42" },
      };

      const groupKey = entry?.groupKeyFn({ event, foldState: {} });
      expect(groupKey).toBe(
        `${tenantId}/fold/traceSummary/reactor/customReactor/custom:run-42`,
      );
    });
  });

  describe("when multiple reactors share a fold parent", () => {
    it("produces different group keys for different reactors on same aggregate", () => {
      const mockQueueProcessor = createMockSharedQueue();
      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      manager.initializeReactorQueues(
        {
          evaluationTrigger: {
            name: "evaluationTrigger",
            parentProjection: "traceSummary",
            parentType: "fold" as const,
            handler: { handle: vi.fn().mockResolvedValue(void 0) },
          },
          customEvalSync: {
            name: "customEvalSync",
            parentProjection: "traceSummary",
            parentType: "fold" as const,
            handler: { handle: vi.fn().mockResolvedValue(void 0) },
          },
        },
        vi.fn(),
      );

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const payload = { event, foldState: {} };

      const evalTriggerEntry = globalJobRegistry.get("test-pipeline:reactor:evaluationTrigger");
      const customSyncEntry = globalJobRegistry.get("test-pipeline:reactor:customEvalSync");

      const evalKey = evalTriggerEntry?.groupKeyFn(payload);
      const syncKey = customSyncEntry?.groupKeyFn(payload);

      // Same aggregate, different reactors → different group keys (no FIFO contention)
      expect(evalKey).not.toBe(syncKey);
      expect(evalKey).toBe(
        `${tenantId}/fold/traceSummary/reactor/evaluationTrigger/${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
      expect(syncKey).toBe(
        `${tenantId}/fold/traceSummary/reactor/customEvalSync/${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });
});
