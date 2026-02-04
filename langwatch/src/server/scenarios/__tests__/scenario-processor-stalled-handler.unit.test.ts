/**
 * Unit tests for the stalled event handler in scenario.processor.ts.
 * @see specs/scenarios/scenario-failure-handler.feature "Worker Death Handling - Stalled Job Behavior"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted() to ensure mock values are available when vi.mock() factories run
// (vi.mock is hoisted to the top of the file, so regular variables aren't available yet)
const { mockWorkerOn, MockWorker, mockLoggerWarn, mockLoggerInfo, mockLoggerError, createMockLogger } = vi.hoisted(() => {
  const mockWorkerOn = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockLoggerInfo = vi.fn();
  const mockLoggerError = vi.fn();

  const createMockLogger = (): Record<string, unknown> => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    child: vi.fn(() => createMockLogger()),
  });

  class MockWorker {
    on = mockWorkerOn;
  }

  return { mockWorkerOn, MockWorker, mockLoggerWarn, mockLoggerInfo, mockLoggerError, createMockLogger };
});

vi.mock("bullmq", () => ({
  Worker: MockWorker,
}));

// Mock redis connection
vi.mock("../../redis", () => ({
  connection: { host: "localhost", port: 6379 },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// Mock processor dependencies
vi.mock("../scenario-failure-handler", () => ({
  ScenarioFailureHandler: {
    create: vi.fn(() => ({
      ensureFailureEventsEmitted: vi.fn(),
    })),
  },
}));

vi.mock("../scenario.service", () => ({
  ScenarioService: {
    create: vi.fn(() => ({
      getById: vi.fn(),
    })),
  },
}));

vi.mock("../../db", () => ({
  prisma: {},
}));

describe("startScenarioProcessor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe("when worker is started", () => {
    it("registers a stalled event handler", async () => {
      // Given: a scenario worker is started
      const { startScenarioProcessor } = await import("../scenario.processor");

      // When: startScenarioProcessor is called
      startScenarioProcessor();

      // Then: worker.on is called with "stalled" event
      const stalledHandler = mockWorkerOn.mock.calls.find(
        ([event]) => event === "stalled"
      );
      expect(stalledHandler).toBeDefined();
    });

    it("logs stalled events at warning level with job ID", async () => {
      // Given: a scenario worker is processing jobs
      const { startScenarioProcessor } = await import("../scenario.processor");
      startScenarioProcessor();

      // Get the stalled event handler
      const stalledHandler = mockWorkerOn.mock.calls.find(
        ([event]) => event === "stalled"
      )?.[1] as (jobId: string) => void;

      expect(stalledHandler).toBeDefined();

      // When: a job becomes stalled
      const jobId = "scenario_proj_123_scen_456_batch_789";
      stalledHandler(jobId);

      // Then: the event is logged at warning level with the job ID
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId }),
        expect.stringContaining("stalled")
      );
    });
  });
});
