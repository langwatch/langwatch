import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../../domain/types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import {
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
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
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const customKeyFn = (event: Event) => `by-tenant:${String(event.tenantId)}`;

      const projections = {
        myProjection: {
          name: "myProjection",
          groupKeyFn: customKeyFn,
        },
      };

      manager.initializeProjectionQueues(projections, vi.fn());

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.groupKey).toBeDefined();

      // Verify custom groupKey produces the expected format
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const groupKey = createCall?.groupKey?.(event);
      expect(groupKey).toBe(`${tenantId}:by-tenant:${tenantId}`);
    });
  });

  describe("when groupKeyFn is not provided", () => {
    it("uses the default aggregateType:aggregateId groupKey", () => {
      const mockQueueProcessor: EventSourcedQueueProcessor<Event> = {
        send: vi.fn().mockResolvedValue(void 0),
        sendBatch: vi.fn().mockResolvedValue(void 0),
        close: vi.fn().mockResolvedValue(void 0),
        waitUntilReady: vi.fn().mockResolvedValue(void 0),
      };

      const queueFactory = {
        create: vi.fn().mockReturnValue(mockQueueProcessor),
      };

      const manager = new QueueManager({
        aggregateType,
        pipelineName: "test-pipeline",
        queueFactory: queueFactory as any,
      });

      const projections = {
        myProjection: {
          name: "myProjection",
        },
      };

      manager.initializeProjectionQueues(projections, vi.fn());

      const createCall = queueFactory.create.mock.calls[0]?.[0];
      expect(createCall?.groupKey).toBeDefined();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );
      const groupKey = createCall?.groupKey?.(event);
      expect(groupKey).toBe(
        `${tenantId}:${aggregateType}:${TEST_CONSTANTS.AGGREGATE_ID}`,
      );
    });
  });
});
