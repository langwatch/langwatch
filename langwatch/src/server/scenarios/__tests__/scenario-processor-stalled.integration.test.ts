/**
 * Integration tests for stalled job handling in scenario.processor.ts.
 *
 * These tests verify the module boundary between BullMQ worker and
 * the failure handler. External dependencies (Redis, ScenarioFailureHandler)
 * are mocked at the boundary.
 *
 * @see specs/scenarios/scenario-failure-handler.feature
 *   - "Worker logs stalled jobs with warning level"
 *   - "Stalled job triggers failure handler after detection"
 */

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Job } from "bullmq";
import type { ScenarioJob, ScenarioJobResult } from "../scenario.queue";
import type { ProcessorDependencies } from "../scenario.processor";

// ============================================================================
// Mock Setup
// ============================================================================

// Track registered event handlers
type WorkerEventHandler = (jobId: string) => void;
type FailedEventHandler = (job: Job | undefined, error: Error) => void;

interface MockWorkerEventHandlers {
  ready: (() => void) | undefined;
  stalled: WorkerEventHandler | undefined;
  failed: FailedEventHandler | undefined;
  completed: ((job: Job, result: ScenarioJobResult) => void) | undefined;
}

const mockEventHandlers: MockWorkerEventHandlers = {
  ready: undefined,
  stalled: undefined,
  failed: undefined,
  completed: undefined,
};

// Mock BullMQ Worker to capture event handlers
class MockWorker {
  on(
    event: string,
    handler: ((...args: unknown[]) => void) | ((...args: unknown[]) => Promise<void>)
  ): this {
    if (event in mockEventHandlers) {
      mockEventHandlers[event as keyof MockWorkerEventHandlers] = handler as never;
    }
    return this;
  }
}

vi.mock("bullmq", () => ({
  Worker: MockWorker,
}));

// Mock redis connection - provide a fake connection so processor starts
vi.mock("../../redis", () => ({
  connection: { host: "localhost", port: 6379 },
}));

// Mock logger to capture log calls
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

const createMockLogger = () => ({
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
  child: vi.fn(() => createMockLogger()),
});

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// Mock database
vi.mock("../../db", () => ({
  prisma: {},
}));

// Mock scenario service (not used directly in these tests but required by module)
vi.mock("../scenario.service", () => ({
  ScenarioService: {
    create: vi.fn(() => ({
      getById: vi.fn(),
    })),
  },
}));

// Mock failure handler (not used directly in these tests but required by module)
vi.mock("../scenario-failure-handler", () => ({
  ScenarioFailureHandler: {
    create: vi.fn(() => ({
      ensureFailureEventsEmitted: vi.fn(),
    })),
  },
}));

// ============================================================================
// Test Helpers
// ============================================================================

const ASYNC_HANDLER_SETTLE_MS = 50;

async function waitForAsyncHandlers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ASYNC_HANDLER_SETTLE_MS));
}

function createMockJob(overrides: Partial<Job<ScenarioJob, ScenarioJobResult, string>> = {}): Job<ScenarioJob, ScenarioJobResult, string> {
  return {
    id: "scenario_proj_123_scen_456_batch_789",
    data: {
      projectId: "proj_123",
      scenarioId: "scen_456",
      setId: "set_abc",
      batchRunId: "batch_789",
      target: { type: "http", referenceId: "agent_123" },
    },
    ...overrides,
  } as Job<ScenarioJob, ScenarioJobResult, string>;
}

function createMockDependencies(): {
  deps: ProcessorDependencies;
  mockGetById: Mock;
  mockEnsureFailureEventsEmitted: Mock;
} {
  const mockGetById = vi.fn().mockResolvedValue({
    name: "Test Scenario",
    situation: "Test description",
  });
  const mockEnsureFailureEventsEmitted = vi.fn().mockResolvedValue(undefined);

  return {
    deps: {
      scenarioLookup: {
        getById: mockGetById,
      },
      failureEmitter: {
        ensureFailureEventsEmitted: mockEnsureFailureEventsEmitted,
      },
    },
    mockGetById,
    mockEnsureFailureEventsEmitted,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("startScenarioProcessor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset event handlers
    mockEventHandlers.ready = undefined;
    mockEventHandlers.stalled = undefined;
    mockEventHandlers.failed = undefined;
    mockEventHandlers.completed = undefined;
  });

  describe("when worker logs stalled jobs with warning level", () => {
    /**
     * @see specs/scenarios/scenario-failure-handler.feature lines 178-184
     * Scenario: Worker logs stalled jobs with warning level
     */

    it("emits a stalled event when a job becomes stalled", async () => {
      // Given: a scenario worker is processing jobs
      const { startScenarioProcessor } = await import("../scenario.processor");
      startScenarioProcessor();

      // When: a job becomes stalled (simulated by calling the stalled handler)
      const stalledHandler = mockEventHandlers.stalled;
      expect(stalledHandler).toBeDefined();

      // Then: the worker has registered a stalled event handler
      // (The handler being registered means the worker emits stalled events)
    });

    it("logs at warning level when a job becomes stalled", async () => {
      // Given: a scenario worker is processing jobs
      const { startScenarioProcessor } = await import("../scenario.processor");
      startScenarioProcessor();

      const stalledHandler = mockEventHandlers.stalled;
      expect(stalledHandler).toBeDefined();

      // When: a job becomes stalled
      const jobId = "scenario_proj_123_scen_456_batch_789";
      stalledHandler!(jobId);

      // Then: the event is logged at warning level
      expect(mockLoggerWarn).toHaveBeenCalled();
    });

    it("includes job ID in the stalled log message", async () => {
      // Given: a scenario worker is processing jobs
      const { startScenarioProcessor } = await import("../scenario.processor");
      startScenarioProcessor();

      const stalledHandler = mockEventHandlers.stalled;
      expect(stalledHandler).toBeDefined();

      // When: a job becomes stalled
      const jobId = "scenario_proj_123_scen_456_batch_789";
      stalledHandler!(jobId);

      // Then: the log includes the job ID
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId }),
        expect.stringContaining("stalled")
      );
    });
  });

  describe("when stalled job triggers failure handler after detection", () => {
    /**
     * @see specs/scenarios/scenario-failure-handler.feature lines 186-193
     * Scenario: Stalled job triggers failure handler after detection
     *
     * This tests the integration between:
     * - BullMQ's "failed" event (triggered when a stalled job exceeds maxStalledCount)
     * - The failure handler being invoked with appropriate error message
     */

    it("calls ensureFailureEventsEmitted when a job fails due to stalling", async () => {
      // Given: a scenario job is being processed
      // And: the worker dies mid-execution (simulated by BullMQ detecting stall)
      const { startScenarioProcessor } = await import("../scenario.processor");
      const { deps, mockEnsureFailureEventsEmitted } = createMockDependencies();

      startScenarioProcessor(deps);

      const failedHandler = mockEventHandlers.failed;
      expect(failedHandler).toBeDefined();

      // When: BullMQ detects the stalled job and transitions it to failed state
      const mockJob = createMockJob();
      const stalledError = new Error("job stalled more than allowable limit");

      failedHandler!(mockJob, stalledError);

      // Allow async handler to complete
      await waitForAsyncHandlers();

      // Then: the job transitions to failed state (implicitly, via the failed event)
      // And: ScenarioFailureHandler.ensureFailureEventsEmitted is called
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalled();
    });

    it("passes the stalled error message to the failure handler", async () => {
      // Given: a scenario job is being processed
      const { startScenarioProcessor } = await import("../scenario.processor");
      const { deps, mockEnsureFailureEventsEmitted } = createMockDependencies();

      startScenarioProcessor(deps);

      const failedHandler = mockEventHandlers.failed;
      expect(failedHandler).toBeDefined();

      // When: BullMQ detects the stalled job
      const mockJob = createMockJob();
      const stalledError = new Error("job stalled more than allowable limit");

      failedHandler!(mockJob, stalledError);

      // Allow async handler to complete
      await waitForAsyncHandlers();

      // Then: the error message indicates the job was stalled
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "job stalled more than allowable limit",
        })
      );
    });

    it("includes job data in the failure handler call", async () => {
      // Given: a scenario job with specific identifiers
      const { startScenarioProcessor } = await import("../scenario.processor");
      const { deps, mockEnsureFailureEventsEmitted, mockGetById } = createMockDependencies();

      mockGetById.mockResolvedValue({
        name: "Stalled Test Scenario",
        situation: "Testing stall detection",
      });

      startScenarioProcessor(deps);

      const failedHandler = mockEventHandlers.failed;
      expect(failedHandler).toBeDefined();

      // When: the job fails due to stalling
      const mockJob = createMockJob({
        id: "scenario_proj_test_scen_test_batch_test",
        data: {
          projectId: "proj_test",
          scenarioId: "scen_test",
          setId: "set_test",
          batchRunId: "batch_test",
          target: { type: "http", referenceId: "agent_test" },
        },
      });
      const stalledError = new Error("job stalled");

      failedHandler!(mockJob, stalledError);

      // Allow async handler to complete
      await waitForAsyncHandlers();

      // Then: the failure handler receives the correct job identifiers
      expect(mockEnsureFailureEventsEmitted).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj_test",
          scenarioId: "scen_test",
          setId: "set_test",
          batchRunId: "batch_test",
        })
      );
    });

    it("logs the failed job at error level", async () => {
      // Given: a scenario worker is processing jobs
      const { startScenarioProcessor } = await import("../scenario.processor");
      const { deps } = createMockDependencies();

      startScenarioProcessor(deps);

      const failedHandler = mockEventHandlers.failed;
      expect(failedHandler).toBeDefined();

      // When: a job fails due to stalling
      const mockJob = createMockJob();
      const stalledError = new Error("job stalled more than allowable limit");

      failedHandler!(mockJob, stalledError);

      // Then: the failure is logged at error level
      // Note: jobId/scenarioId are bound via logger.child(), error is passed as string
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: stalledError.message,
        }),
        expect.stringContaining("failed")
      );
    });

    it("handles undefined job in failed event gracefully", async () => {
      // Given: a scenario worker is processing jobs
      const { startScenarioProcessor } = await import("../scenario.processor");
      const { deps, mockEnsureFailureEventsEmitted } = createMockDependencies();

      startScenarioProcessor(deps);

      const failedHandler = mockEventHandlers.failed;
      expect(failedHandler).toBeDefined();

      // When: BullMQ emits a failed event with undefined job
      // (This can happen in edge cases with BullMQ)
      const stalledError = new Error("job stalled");

      // This should not throw
      failedHandler!(undefined, stalledError);

      // Allow async handler to complete
      await waitForAsyncHandlers();

      // Then: the failure handler is NOT called (no job data available)
      expect(mockEnsureFailureEventsEmitted).not.toHaveBeenCalled();
    });

    it("catches and logs errors from failure handler without crashing", async () => {
      // Given: a scenario worker with a failure handler that throws
      const { startScenarioProcessor } = await import("../scenario.processor");
      const { deps, mockEnsureFailureEventsEmitted } = createMockDependencies();

      mockEnsureFailureEventsEmitted.mockRejectedValue(
        new Error("Elasticsearch connection failed")
      );

      startScenarioProcessor(deps);

      const failedHandler = mockEventHandlers.failed;
      expect(failedHandler).toBeDefined();

      // When: a job fails and the failure handler throws
      const mockJob = createMockJob();
      const stalledError = new Error("job stalled");

      // This should not throw
      failedHandler!(mockJob, stalledError);

      // Allow async handler to complete
      await waitForAsyncHandlers();

      // Then: the error from the failure handler is logged but doesn't crash
      // Note: jobId/scenarioId are bound via logger.child(), emitError is passed in call
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          emitError: expect.any(Error),
        }),
        expect.stringContaining("Failed to emit failure events")
      );
    });
  });
});
