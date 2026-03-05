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

describe("QueueManager.initializeProjectionQueues with groupKeyFn", () => {
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

  describe("when groupKeyFn is provided", () => {
    it("uses the custom groupKey function with tenantId prefix", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const customKeyFn = (event: Event) => `by-tenant:${String(event.tenantId)}`;

      const projections = {
        myProjection: {
          name: "myProjection",
          groupKeyFn: customKeyFn,
        },
      };

      manager.initializeProjectionQueues(projections, vi.fn());

      // The registry entry's groupKeyFn dispatches to the projection's custom groupKeyFn
      const entry = globalJobRegistry.get("test-pipeline:projection:myProjection");
      expect(entry?.groupKeyFn).toBeDefined();

      // Call groupKeyFn with the event
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const groupKey = entry?.groupKeyFn(event);
      expect(groupKey).toBe(`${tenantId}:by-tenant:${tenantId}`);
    });
  });

  describe("when groupKeyFn is not provided", () => {
    it("uses the default aggregateType:aggregateId groupKey", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const projections = {
        myProjection: {
          name: "myProjection",
        },
      };

      manager.initializeProjectionQueues(projections, vi.fn());

      const entry = globalJobRegistry.get("test-pipeline:projection:myProjection");
      expect(entry?.groupKeyFn).toBeDefined();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const groupKey = entry?.groupKeyFn(event);
      expect(groupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });

  describe("when mixing custom and default groupKeyFn projections", () => {
    it("dispatches to the correct groupKeyFn per projection", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<any> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const globalJobRegistry = new Map<string, JobRegistryEntry>();

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        globalQueue: mockQueueProcessor,
        globalJobRegistry,
      });

      const customKeyFn = (event: Event) => `custom:${event.id}`;

      const projections = {
        customProjection: {
          name: "customProjection",
          groupKeyFn: customKeyFn,
        },
        defaultProjection: {
          name: "defaultProjection",
        },
      };

      manager.initializeProjectionQueues(projections, vi.fn());

      // Both entries registered
      expect(globalJobRegistry.has("test-pipeline:projection:customProjection")).toBe(true);
      expect(globalJobRegistry.has("test-pipeline:projection:defaultProjection")).toBe(true);

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      // Custom projection uses its custom groupKeyFn
      const customEntry = globalJobRegistry.get("test-pipeline:projection:customProjection");
      const customGroupKey = customEntry?.groupKeyFn(event);
      expect(customGroupKey).toBe(`${tenantId}:custom:${event.id}`);

      // Default projection uses aggregate-based groupKey
      const defaultEntry = globalJobRegistry.get("test-pipeline:projection:defaultProjection");
      const defaultGroupKey = defaultEntry?.groupKeyFn(event);
      expect(defaultGroupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });
});
