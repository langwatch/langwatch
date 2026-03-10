/**
 * Integration tests for AbortSignal handling in processScenarioJob.
 *
 * Tests that BullMQ's native AbortSignal is wired through to the spawned child
 * process: when the signal fires, the child receives SIGTERM; when the signal is
 * already aborted at start, the processor returns early without spawning.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 *   "Cancelling a running job terminates its child process"
 *   "Worker respects the abort signal during job execution"
 */

import { EventEmitter } from "events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { ScenarioJob, ScenarioJobResult } from "../scenario.queue";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports from the module under test
// ---------------------------------------------------------------------------

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: mockSpawn }));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../redis", () => ({ connection: null }));
vi.mock("../execution/data-prefetcher", () => ({
  prefetchScenarioData: vi.fn(),
  createDataPrefetcherDependencies: vi.fn(),
}));
vi.mock("../metrics", () => ({
  recordJobWaitDuration: vi.fn(),
  getJobProcessingCounter: () => ({ inc: vi.fn() }),
  getJobProcessingDurationHistogram: () => ({ observe: vi.fn() }),
}));
vi.mock("../context/asyncContext", () => ({
  createContextFromJobData: vi.fn().mockReturnValue({}),
  runWithContext: vi.fn().mockImplementation((_ctx: unknown, fn: () => unknown) => fn()),
}));
vi.mock("../scenario-failure-handler", () => ({
  ScenarioFailureHandler: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("../scenario.service", () => ({
  ScenarioService: vi.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks are declared
// ---------------------------------------------------------------------------

import { processScenarioJob } from "../scenario.processor";
import { prefetchScenarioData } from "../execution/data-prefetcher";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fake ChildProcess EventEmitter with a `kill` spy and controllable
 * stdio streams. Calling `emitClose(code)` simulates process exit.
 */
function createFakeChild() {
  const child = new EventEmitter() as NodeJS.EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
    emitClose: (code: number) => void;
  };

  child.kill = vi.fn();
  const stdin = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.emitClose = (code: number) => child.emit("close", code);

  return child;
}

/**
 * Builds a minimal mock Job that satisfies processScenarioJob's expectations.
 */
function createMockJob(overrides: Partial<ScenarioJob> = {}): Job<ScenarioJob, ScenarioJobResult, string> {
  const data: ScenarioJob = {
    projectId: "test-project",
    scenarioId: "test-scenario",
    setId: "test-set",
    batchRunId: "test-batch",
    target: { type: "http", referenceId: "agent-1" },
    ...overrides,
  };

  return {
    id: "job-1",
    data,
    log: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn(),
  } as unknown as Job<ScenarioJob, ScenarioJobResult, string>;
}

/**
 * Builds a minimal successful prefetch result.
 */
function createSuccessfulPrefetch() {
  return {
    success: true as const,
    data: {
      context: {
        projectId: "test-project",
        scenarioId: "test-scenario",
        setId: "test-set",
        batchRunId: "test-batch",
      },
      scenario: {
        id: "test-scenario",
        name: "Test",
        situation: "A user asks something",
        criteria: ["Respond politely"],
        labels: [],
      },
      adapterData: {
        type: "http" as const,
        agentId: "agent-1",
        url: "http://localhost/api",
        method: "POST" as const,
        headers: [],
      },
      modelParams: { api_key: "key", model: "openai/gpt-4o-mini" },
      nlpServiceUrl: "http://localhost:8080",
      target: { type: "http" as const, referenceId: "agent-1" },
    },
    telemetry: { endpoint: "http://localhost:4318", apiKey: "test-key" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processScenarioJob - AbortSignal handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the abort signal is already aborted at job start", () => {
    it("returns early without spawning a child process", async () => {
      const job = createMockJob();
      const signal = AbortSignal.abort();

      const result = await processScenarioJob(job, undefined, signal);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: "Job was cancelled before processing started",
      });
    });

    it("does not call prefetchScenarioData", async () => {
      const job = createMockJob();
      const signal = AbortSignal.abort();

      await processScenarioJob(job, undefined, signal);

      expect(prefetchScenarioData).not.toHaveBeenCalled();
    });
  });

  describe("when the abort signal fires after the child process has started", () => {
    it("sends SIGTERM to the spawned child process", async () => {
      const fakeChild = createFakeChild();
      mockSpawn.mockReturnValue(fakeChild);
      vi.mocked(prefetchScenarioData).mockResolvedValue(createSuccessfulPrefetch());

      const abortController = new AbortController();
      const job = createMockJob();

      // Start processing but do not resolve the child yet
      const processingPromise = processScenarioJob(job, undefined, abortController.signal);

      // Wait a tick for the child to be spawned and listeners to attach
      await new Promise((resolve) => setImmediate(resolve));

      // Fire the abort signal — this should kill the child
      abortController.abort();

      // Simulate child process dying after receiving SIGTERM
      fakeChild.emitClose(143); // 128 + 15 (SIGTERM)

      await processingPromise;

      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});
