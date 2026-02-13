import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCheckpointKey } from "../../../utils/checkpointKey";
import {
  createMockCheckpointStore,
  createTestAggregateType,
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers";
import { saveCheckpointSafely } from "../saveCheckpointSafely";

describe("saveCheckpointSafely", () => {
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

  describe("when checkpoint store is not provided", () => {
    it("returns without saving", async () => {
      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await saveCheckpointSafely({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        componentName: "processor",
        componentType: "handler",
        event,
        status: "pending",
        sequenceNumber: 1,
      });

      // Should complete without error
      expect(true).toBe(true);
    });
  });

  describe("when checkpoint store is provided", () => {
    it("saves checkpoint successfully", async () => {
      const checkpointStore = createMockCheckpointStore();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await saveCheckpointSafely({
        checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        componentName: "processor",
        componentType: "handler",
        event,
        status: "pending",
        sequenceNumber: 1,
      });

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
      const checkpointStore = createMockCheckpointStore();

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await saveCheckpointSafely({
        checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        componentName: "processor",
        componentType: "handler",
        event,
        status: "failed",
        sequenceNumber: 1,
        errorMessage: "Test error message",
      });

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
      const checkpointStore = createMockCheckpointStore();
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockRejectedValue(new Error("Checkpoint save failed"));

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      // Should not throw
      await saveCheckpointSafely({
        checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        componentName: "processor",
        componentType: "handler",
        event,
        status: "pending",
        sequenceNumber: 1,
      });

      expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
    });

    it("does not throw when saveCheckpoint fails for processed status", async () => {
      const checkpointStore = createMockCheckpointStore();
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockRejectedValue(new Error("Checkpoint save failed"));

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await saveCheckpointSafely({
        checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        componentName: "processor",
        componentType: "handler",
        event,
        status: "processed",
        sequenceNumber: 1,
      });

      expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
    });

    it("does not throw when saveCheckpoint fails for failed status", async () => {
      const checkpointStore = createMockCheckpointStore();
      checkpointStore.saveCheckpoint = vi
        .fn()
        .mockRejectedValue(new Error("Checkpoint save failed"));

      const event = createTestEvent(
        TEST_CONSTANTS.AGGREGATE_ID,
        aggregateType,
        tenantId,
      );

      await saveCheckpointSafely({
        checkpointStore,
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        componentName: "processor",
        componentType: "handler",
        event,
        status: "failed",
        sequenceNumber: 1,
        errorMessage: "Test error",
      });

      expect(checkpointStore.saveCheckpoint).toHaveBeenCalled();
    });
  });
});
