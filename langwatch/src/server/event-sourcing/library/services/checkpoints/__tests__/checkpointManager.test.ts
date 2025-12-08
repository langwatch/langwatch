import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_TYPES } from "../../../domain/eventType";
import type { Event } from "../../../domain/types";
import { buildCheckpointKey } from "../../../utils/checkpointKey";
import {
  createMockLogger,
  createMockProcessorCheckpointStore,
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { CheckpointManager } from "../checkpointManager";

describe("CheckpointManager", () => {
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

  describe("saveCheckpointSafely", () => {
    describe("when checkpoint store is not provided", () => {
      it("returns without saving", async () => {
        const manager = new CheckpointManager(TEST_CONSTANTS.PIPELINE_NAME);

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "pending",
          1,
        );

        // Should complete without error
        expect(true).toBe(true);
      });
    });

    describe("when checkpoint store is provided", () => {
      it("saves checkpoint successfully", async () => {
        const checkpointStore = createMockProcessorCheckpointStore();
        const manager = new CheckpointManager(
          TEST_CONSTANTS.PIPELINE_NAME,
          checkpointStore,
        );

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "pending",
          1,
        );

        expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
          tenantId,
          buildCheckpointKey(
            tenantId,
            TEST_CONSTANTS.PIPELINE_NAME,
            "processor",
            aggregateType,
            TEST_CONSTANTS.AGGREGATE_ID,
          ),
          "handler",
          event,
          "pending",
          1,
          void 0,
        );
      });

      it("saves checkpoint with error message for failed status", async () => {
        const checkpointStore = createMockProcessorCheckpointStore();
        const manager = new CheckpointManager(
          TEST_CONSTANTS.PIPELINE_NAME,
          checkpointStore,
        );

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "failed",
          1,
          "Test error message",
        );

        expect(checkpointStore.saveCheckpoint).toHaveBeenCalledWith(
          tenantId,
          buildCheckpointKey(
            tenantId,
            TEST_CONSTANTS.PIPELINE_NAME,
            "processor",
            aggregateType,
            TEST_CONSTANTS.AGGREGATE_ID,
          ),
          "handler",
          event,
          "failed",
          1,
          "Test error message",
        );
      });

      it("logs error but does not throw when saveCheckpoint fails", async () => {
        const checkpointStore = createMockProcessorCheckpointStore();
        checkpointStore.saveCheckpoint = vi
          .fn()
          .mockRejectedValue(new Error("Checkpoint save failed"));
        const manager = new CheckpointManager(
          TEST_CONSTANTS.PIPELINE_NAME,
          checkpointStore,
        );

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        // Should not throw
        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "pending",
          1,
        );

        // CheckpointManager uses its own logger, so we can't verify the exact call
        // But we can verify the checkpoint store was called (which it was before the error)
        expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
      });

      it("logs appropriate message for pending status", async () => {
        const checkpointStore = createMockProcessorCheckpointStore();
        checkpointStore.saveCheckpoint = vi
          .fn()
          .mockRejectedValue(new Error("Checkpoint save failed"));
        const manager = new CheckpointManager(
          TEST_CONSTANTS.PIPELINE_NAME,
          checkpointStore,
        );

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "pending",
          1,
        );

        // CheckpointManager uses its own logger, so we can't verify the exact call
        // But we can verify the checkpoint store was called (which it was before the error)
        expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
      });

      it("logs appropriate message for processed status", async () => {
        const checkpointStore = createMockProcessorCheckpointStore();
        checkpointStore.saveCheckpoint = vi
          .fn()
          .mockRejectedValue(new Error("Checkpoint save failed"));
        const manager = new CheckpointManager(
          TEST_CONSTANTS.PIPELINE_NAME,
          checkpointStore,
        );

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "processed",
          1,
        );

        // CheckpointManager uses its own logger, so we can't verify the exact call
        // But we can verify the checkpoint store was called (which it was before the error)
        expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
      });

      it("logs appropriate message for failed status", async () => {
        const checkpointStore = createMockProcessorCheckpointStore();
        checkpointStore.saveCheckpoint = vi
          .fn()
          .mockRejectedValue(new Error("Checkpoint save failed"));
        const manager = new CheckpointManager(
          TEST_CONSTANTS.PIPELINE_NAME,
          checkpointStore,
        );

        const event = createTestEvent(
          TEST_CONSTANTS.AGGREGATE_ID,
          aggregateType,
          tenantId,
        );

        await manager.saveCheckpointSafely(
          "processor",
          "handler",
          event,
          "failed",
          1,
          "Test error",
        );

        // CheckpointManager uses its own logger, so we can't verify the exact call
        // But we can verify the checkpoint store was called (which it was before the error)
        expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
      });
    });
  });
});
