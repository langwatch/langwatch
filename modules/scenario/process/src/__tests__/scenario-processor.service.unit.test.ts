import { ChildProcess } from "node:child_process";

import {
  type RedTeamRunReport,
  type ScenarioExecutionService,
  type ScenarioExecutionPrefetchResult,
} from "@langwatch/scenario-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CancellationSubscriber,
  type CancellationMessage,
  type ScenarioChildExecutionSession,
  type ScenarioExecutionRunner,
  type ScenarioProcessorServiceMetrics,
} from "../app/scenario.app.ts";
import { buildOtelResourceAttributes } from "../channels/scenario-child.node.channel.ts";
import { parseChildProcessResult } from "../channels/scenario-child.supervisor.channel.ts";
import type { ScenarioChildChoiceService } from "../features/child/services/scenario-child-choice.service.ts";
import { RedTeamBreakNotRecordedError } from "../features/red-team/services/red-team-report-writer.service.ts";
import {
  ScenarioExecutionPoolService,
  type ExecutionJobData,
} from "../services/scenario-execution-pool.service.ts";
import { ScenarioProcessorService } from "../services/scenario-processor.service.ts";

const job = (id: string): ExecutionJobData => ({
  projectId: "project-1",
  scenarioId: `scenario-${id}`,
  scenarioRunId: id,
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "http", referenceId: "agent-1" },
});

class TestCancellationSubscriber implements CancellationSubscriber {
  private onCancellation: ((message: CancellationMessage) => void) | undefined = void 0;

  subscribe(onCancellation: (message: CancellationMessage) => void): Promise<() => Promise<void>> {
    this.onCancellation = onCancellation;
    return Promise.resolve(async () => {
      this.onCancellation = void 0;
    });
  }

  emit(message: CancellationMessage): void {
    if (!this.onCancellation) {
      throw new Error("Cancellation subscriber has not started");
    }

    this.onCancellation(message);
  }
}

class TestMetrics implements ScenarioProcessorServiceMetrics {
  startedCount = 0;
  completedCount = 0;
  failedCount = 0;

  started(): void {
    this.startedCount += 1;
  }

  completed(): void {
    this.completedCount += 1;
  }

  failed(): void {
    this.failedCount += 1;
  }
}

class HoldingExecutionRunner implements ScenarioExecutionRunner {
  constructor(
    private readonly pool: ScenarioExecutionPoolService,
    private readonly child: ChildProcess,
  ) {}

  /** Holds like a live child: the real runner settles only after its child exits. */
  execute(jobData: ExecutionJobData): Promise<void> {
    this.pool.registerChild(jobData.scenarioRunId, this.child);
    return new Promise<void>(() => {});
  }

  skipCancelled(): void {}
}

function processorFixture() {
  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  const execution = createApiFixture<ScenarioExecutionService>();
  const childProcesses = createApiFixture<ScenarioChildChoiceService>();
  const finishUnsuccessfulRun = vi.fn().mockResolvedValue(undefined);
  const cancellations = new TestCancellationSubscriber();
  const metrics = new TestMetrics();
  execution.finishUnsuccessfulRun = finishUnsuccessfulRun;

  const processor = ScenarioProcessorService.create({
    execution,
    pool,
    cancellations,
    childProcesses,
    metrics,
  });
  pool.connect(processor);
  return {
    processor,
    pool,
    execution,
    childProcesses,
    cancellations,
    finishUnsuccessfulRun,
    metrics,
  };
}

class TestChildSession implements ScenarioChildExecutionSession {
  readonly execute = vi.fn().mockResolvedValue({ success: true });
  readonly abort = vi.fn().mockResolvedValue(undefined);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error("Deferred promise was not initialised");
      resolvePromise(value);
    },
    reject(reason) {
      if (!rejectPromise) throw new Error("Deferred promise was not initialised");
      rejectPromise(reason);
    },
  };
}

describe("ScenarioProcessorService", () => {
  describe("given a failed run", () => {
    /** @scenario Include job metadata in failure events */
    it("finishes with the complete run and target context", async () => {
      const fixture = processorFixture();

      await fixture.processor.handleFailed({ jobData: job("run-1"), error: "Prefetch failed" });

      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith({
        projectId: "project-1",
        scenarioId: "scenario-run-1",
        setId: "set-1",
        batchRunId: "batch-1",
        scenarioRunId: "run-1",
        error: "Prefetch failed",
        target: { type: "http", referenceId: "agent-1" },
      });
    });

    it("propagates completion failures", async () => {
      const fixture = processorFixture();
      fixture.finishUnsuccessfulRun.mockRejectedValue(new Error("write failed"));

      await expect(
        fixture.processor.handleFailed({ jobData: job("run-1"), error: "failed" }),
      ).rejects.toThrow("write failed");
    });
  });

  describe("when the hook record of a run whose setup failed cannot be written", () => {
    /** @scenario "A failed setup whose record cannot be written is logged as an error" */
    it("logs an error, not a warning, and never fails the job", async () => {
      const fixture = processorFixture();
      fixture.execution.recordHooks = () => Promise.reject(new Error("store down"));
      const { logger, lines } = createTestLogger();

      await fixture.processor.recordHooks({
        jobData: job("run-1"),
        result: { success: false, hooks: { setup: { status: "failed", durationMs: 5 } } },
        jobLogger: logger,
      });

      expect(lines.findLine("error", "Could not record a failed setup")).toMatchObject({
        scenarioRunId: "run-1",
      });
      expect(lines.findLine("warn", "Could not record")).toBeUndefined();
    });

    /** @scenario "A child startup failure is stored on the run" */
    it("stores the child startup message and releases the pool", async () => {
      const fixture = processorFixture();
      const message =
        "Scenario child bundle is missing and tsx is unavailable. Run `pnpm install` or `pnpm --filter @langwatch/scenario-child build`.";
      fixture.childProcesses.start = vi.fn().mockRejectedValue(new Error(message));
      fixture.execution.prepare = vi.fn().mockReturnValue({
        childEnvironment: Promise.resolve({
          labels: ["smoke"],
          telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
        }),
        result: new Promise<ScenarioExecutionPrefetchResult>(() => {}),
      });

      fixture.pool.submit(job("startup"));
      fixture.pool.submit(job("next"));

      await vi.waitFor(() => {
        expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledTimes(2);
      });

      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "startup", error: message }),
      );
      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "next", error: message }),
      );
      expect(fixture.metrics.startedCount).toBe(2);
      expect(fixture.metrics.failedCount).toBe(2);
      expect(fixture.pool.activeCount).toBe(0);
      expect(fixture.pool.pendingCount).toBe(0);
    });
  });

  describe("given a finished red team run", () => {
    const report: RedTeamRunReport = {
      outcome: "broke",
      brokeAtTurn: 3,
      strategy: "crescendo",
      owaspIds: ["LLM07"],
      attackGoal: "Reveal the system prompt",
      maxTurns: 30,
      turnsUsed: 3,
      turnScores: [{ turn: 3, score: 9 }],
    };

    /** @scenario "The processor records the child's red team report on the run" */
    it("records the report the child returned", async () => {
      const fixture = processorFixture();
      const recordRedTeamReport = vi.fn().mockResolvedValue(undefined);
      fixture.execution.recordRedTeamReport = recordRedTeamReport;

      await fixture.processor.handleSucceeded({
        jobData: job("run-1"),
        result: { success: true, redTeam: report },
      });

      expect(recordRedTeamReport).toHaveBeenCalledWith({
        projectId: "project-1",
        scenarioRunId: "run-1",
        report,
      });
    });

    /** @scenario "A red team report write that fails once is retried" */
    it("records the report on a later attempt when the first write is refused", async () => {
      const fixture = processorFixture();
      const recordRedTeamReport = vi
        .fn()
        .mockRejectedValueOnce(new Error("store down"))
        .mockResolvedValue(undefined);
      fixture.execution.recordRedTeamReport = recordRedTeamReport;
      const { logger, lines } = createTestLogger();

      await fixture.processor.handleSucceeded({
        jobData: job("run-1"),
        result: { success: true, redTeam: report },
        jobLogger: logger,
      });

      expect(recordRedTeamReport).toHaveBeenCalledTimes(2);
      expect(lines.findLine("error", "Could not record the red team run's report")).toBeUndefined();
    });

    /** @scenario "A broke red team run whose report cannot be written still records the break" */
    it("writes the break without its turn scores after the full report is refused 3 times", async () => {
      const fixture = processorFixture();
      const recordRedTeamReport = vi
        .fn()
        .mockRejectedValueOnce(new Error("payload refused"))
        .mockRejectedValueOnce(new Error("payload refused"))
        .mockRejectedValueOnce(new Error("payload refused"))
        .mockResolvedValue(undefined);
      fixture.execution.recordRedTeamReport = recordRedTeamReport;
      const { logger, lines } = createTestLogger();

      await expect(
        fixture.processor.handleSucceeded({
          jobData: job("run-1"),
          result: { success: true, redTeam: report },
          jobLogger: logger,
        }),
      ).resolves.toBeUndefined();

      expect(recordRedTeamReport).toHaveBeenCalledTimes(4);
      expect(recordRedTeamReport).toHaveBeenLastCalledWith({
        projectId: "project-1",
        scenarioRunId: "run-1",
        report: { ...report, turnScores: [] },
      });
      expect(
        lines.findLine("warn", "Recorded the red team break without its turn scores"),
      ).toMatchObject({
        scenarioRunId: "run-1",
      });
    });

    /** @scenario "A broke red team run whose report cannot be written at all fails the job" */
    it("fails the job after the full report and the break are each refused 3 times", async () => {
      const fixture = processorFixture();
      const recordRedTeamReport = vi.fn().mockRejectedValue(new Error("store down"));
      fixture.execution.recordRedTeamReport = recordRedTeamReport;
      const recordCutAtLimit = vi.fn().mockResolvedValue(undefined);
      fixture.execution.recordCutAtLimit = recordCutAtLimit;
      const { logger, lines } = createTestLogger();

      await expect(
        fixture.processor.handleSucceeded({
          jobData: job("run-1"),
          result: { success: true, redTeam: report, isCutAtLimit: true },
          jobLogger: logger,
        }),
      ).rejects.toBeInstanceOf(RedTeamBreakNotRecordedError);

      expect(recordRedTeamReport).toHaveBeenCalledTimes(6);
      expect(recordCutAtLimit).toHaveBeenCalledOnce();
      expect(
        lines.findLine("error", "Could not record the red team break: failing the job"),
      ).toMatchObject({ scenarioRunId: "run-1" });
    });

    /** @scenario "A broke red team run whose report cannot be written at all fails the job" */
    it("finishes the run unsuccessful and rejects the job when the break is never written", async () => {
      const fixture = processorFixture();
      const session = new TestChildSession();
      const start = vi.fn().mockReturnValue(session);
      fixture.childProcesses.start = start;
      fixture.execution.prepare = vi.fn().mockReturnValue({
        childEnvironment: Promise.resolve(null),
        result: Promise.resolve({
          success: true,
          resolvedModels: null,
          telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
          data: {
            context: {
              projectId: "project-1",
              scenarioId: "scenario-voice",
              setId: "set-1",
              batchRunId: "batch-1",
            },
            scenario: {
              id: "scenario-voice",
              name: "Voice",
              situation: "Calls the agent",
              criteria: [],
              labels: ["voice"],
            },
            parameters: {},
            adapterData: {
              type: "voice",
              agentId: "agent-1",
              voiceTarget: { transport: "elevenlabs_convai", agentId: "el-1", credential: null },
              callerEnv: { OPENAI_API_KEY: "sk-caller-openai" },
              maxCallSeconds: 300,
            },
            simulatorModelParams: { model: "openai/simulator", api_key: "key" },
            judgeModelParams: { model: "openai/judge", api_key: "key" },
            nlpServiceUrl: "http://nlp",
            target: { type: "voice", referenceId: "agent-1" },
          },
        } satisfies ScenarioExecutionPrefetchResult),
      });
      session.execute.mockResolvedValue({ success: true, redTeam: report });
      fixture.execution.recordRedTeamReport = vi.fn().mockRejectedValue(new Error("store down"));

      await expect(fixture.processor.execute(job("run-1"))).rejects.toBeInstanceOf(
        RedTeamBreakNotRecordedError,
      );

      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "run-1",
          error: expect.any(String),
        }),
      );
    });

    /** @scenario "A held red team report that cannot be written is logged and never fails the job" */
    it("logs a held report that cannot be written and never fails the job", async () => {
      const fixture = processorFixture();
      const recordRedTeamReport = vi.fn().mockRejectedValue(new Error("store down"));
      fixture.execution.recordRedTeamReport = recordRedTeamReport;
      const { logger, lines } = createTestLogger();

      await expect(
        fixture.processor.handleSucceeded({
          jobData: job("run-1"),
          result: { success: true, redTeam: { ...report, outcome: "held" } },
          jobLogger: logger,
        }),
      ).resolves.toBeUndefined();

      expect(recordRedTeamReport).toHaveBeenCalledTimes(3);
      expect(lines.findLine("error", "Could not record the red team run's report")).toMatchObject({
        scenarioRunId: "run-1",
        attempts: 3,
      });
    });
  });

  describe("when the worker drains", () => {
    let fixture: ReturnType<typeof processorFixture>;
    let killSignals: (number | NodeJS.Signals | undefined)[];

    beforeEach(() => {
      fixture = processorFixture();
      killSignals = [];
      const child = new ChildProcess();
      child.kill = (signal) => {
        killSignals.push(signal);
        return true;
      };
      fixture.pool.connect(new HoldingExecutionRunner(fixture.pool, child));
      fixture.pool.submit(job("running"));
      fixture.pool.submit(job("pending"));
      fixture.pool.connect(fixture.processor);
    });

    /** @scenario "In-flight runs are failed when the worker restarts" */
    it("finishes running and pending jobs before clearing the pool", async () => {
      await fixture.processor.drain();

      const runIds = fixture.finishUnsuccessfulRun.mock.calls.map(([input]) => input.scenarioRunId);
      expect(runIds).toEqual(expect.arrayContaining(["running", "pending"]));
      expect(fixture.pool.pendingCount).toBe(0);
      expect(killSignals).toContain("SIGTERM");
    });

    /** @scenario "A cancelled in-flight run is preserved as cancelled, not failed" */
    it("preserves cancellation for an in-flight run", async () => {
      fixture.pool.markCancelled("running");

      await fixture.processor.drain();

      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({ scenarioRunId: "running", cancelled: true }),
      );
    });

    /** @scenario Failure handler errors do not crash worker */
    it("isolates a completion failure so every run is attempted", async () => {
      fixture.finishUnsuccessfulRun
        .mockRejectedValueOnce(new Error("first write failed"))
        .mockResolvedValue(undefined);

      await fixture.processor.drain();

      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledTimes(2);
      expect(fixture.pool.pendingCount).toBe(0);
    });

    it("does nothing when no runs are in flight", async () => {
      const empty = processorFixture();

      await empty.processor.drain();

      expect(empty.finishUnsuccessfulRun).not.toHaveBeenCalled();
      expect(empty.pool.pendingCount).toBe(0);
    });
  });

  describe("given a cancellation broadcast", () => {
    /** @scenario "Worker kills its own child process on cancel broadcast" */
    /** @scenario "Worker ignores cancel broadcast for scenarios it does not own" */
    it("kills only the owned child and marks that run as cancelled", async () => {
      const fixture = processorFixture();
      const child = new ChildProcess();
      const kill = vi.fn().mockReturnValue(true);
      child.kill = kill;
      fixture.pool.connect(new HoldingExecutionRunner(fixture.pool, child));
      fixture.pool.submit(job("owned-run"));

      const lifecycle = await fixture.processor.start();
      fixture.cancellations.emit({
        projectId: "project-1",
        scenarioRunId: "other-run",
      });
      fixture.cancellations.emit({
        projectId: "project-1",
        scenarioRunId: "owned-run",
      });

      expect(kill).toHaveBeenCalledOnce();
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      expect(fixture.pool.wasCancelled("other-run")).toBe(true);
      expect(fixture.pool.wasCancelled("owned-run")).toBe(true);

      await lifecycle.close();
    });
  });

  /** @scenario "Worker skips execution if cancel was already requested" */
  it("writes a cancelled terminal result when the pool skips a job", async () => {
    const fixture = processorFixture();
    fixture.pool.markCancelled("cancelled");

    fixture.pool.submit(job("cancelled"));
    await vi.waitFor(() => {
      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
        expect.objectContaining({
          scenarioRunId: "cancelled",
          cancelled: true,
          error: "Cancelled before execution started",
        }),
      );
    });
  });

  /** @scenario "Child startup overlaps slow preparation" */
  /** @scenario Worker does not call failure handler on success */
  it("boots the isolated child while target and model prefetch continue", async () => {
    const fixture = processorFixture();
    const result = deferred<ScenarioExecutionPrefetchResult>();
    const session = new TestChildSession();
    const start = vi.fn().mockReturnValue(session);
    fixture.childProcesses.start = start;
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve({
        labels: ["smoke"],
        telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
      }),
      result: result.promise,
    });

    const execution = fixture.processor.execute(job("overlap"));

    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(session.execute).not.toHaveBeenCalled();

    result.resolve({
      success: true,
      resolvedModels: null,
      telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
      data: {
        context: {
          projectId: "project-1",
          scenarioId: "scenario-overlap",
          setId: "set-1",
          batchRunId: "batch-1",
        },
        scenario: {
          id: "scenario-overlap",
          name: "Overlap",
          situation: "Waits for prefetch",
          criteria: [],
          labels: ["smoke"],
        },
        parameters: {},
        adapterData: {
          type: "http",
          agentId: "agent-1",
          url: "https://example.com",
          method: "POST",
          headers: [],
          secrets: {},
        },
        simulatorModelParams: { model: "openai/simulator", api_key: "key" },
        judgeModelParams: { model: "openai/judge", api_key: "key" },
        nlpServiceUrl: "http://nlp",
        target: { type: "http", referenceId: "agent-1" },
      },
    });

    await execution;
    expect(session.execute).toHaveBeenCalledTimes(1);
    expect(fixture.finishUnsuccessfulRun).not.toHaveBeenCalled();
  });

  it("starts a voice child after preparation with the caller env the prefetch resolved", async () => {
    const fixture = processorFixture();
    const session = new TestChildSession();
    const start = vi.fn().mockReturnValue(session);
    fixture.childProcesses.start = start;
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve(null),
      result: Promise.resolve({
        success: true,
        resolvedModels: null,
        telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
        data: {
          context: {
            projectId: "project-1",
            scenarioId: "scenario-voice",
            setId: "set-1",
            batchRunId: "batch-1",
          },
          scenario: {
            id: "scenario-voice",
            name: "Voice",
            situation: "Calls the agent",
            criteria: [],
            labels: ["voice"],
          },
          parameters: {},
          adapterData: {
            type: "voice",
            agentId: "agent-1",
            voiceTarget: { transport: "elevenlabs_convai", agentId: "el-1", credential: null },
            callerEnv: { OPENAI_API_KEY: "sk-caller-openai" },
            maxCallSeconds: 300,
          },
          simulatorModelParams: { model: "openai/simulator", api_key: "key" },
          judgeModelParams: { model: "openai/judge", api_key: "key" },
          nlpServiceUrl: "http://nlp",
          target: { type: "voice", referenceId: "agent-1" },
        },
      } satisfies ScenarioExecutionPrefetchResult),
    });

    await fixture.processor.execute({
      ...job("voice-run"),
      target: { type: "voice", referenceId: "agent-1" },
    });

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[0].environment.callerEnv).toEqual({
      OPENAI_API_KEY: "sk-caller-openai",
    });
  });

  /** @scenario "Child startup overlaps slow preparation" */
  it("aborts an early child when preparation fails", async () => {
    const fixture = processorFixture();
    const result = deferred<ScenarioExecutionPrefetchResult>();
    const session = new TestChildSession();
    fixture.childProcesses.start = vi.fn().mockReturnValue(session);
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve({
        labels: [],
        telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
      }),
      result: result.promise,
    });

    const execution = fixture.processor.execute(job("prefetch-failure"));
    await vi.waitFor(() => expect(fixture.childProcesses.start).toHaveBeenCalledOnce());

    result.resolve({ success: false, error: "target unavailable" });
    await execution;

    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.execute).not.toHaveBeenCalled();
    expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
      expect.objectContaining({ error: "target unavailable" }),
    );
  });

  it("finishes the run as failed when preparation throws", async () => {
    const fixture = processorFixture();
    const thrown = new Error("Failed to decrypt project secret");
    const result = deferred<ScenarioExecutionPrefetchResult>();
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve(null),
      result: result.promise,
    });

    const execution = fixture.processor.execute(job("prefetch-throws"));
    result.reject(thrown);

    await expect(execution).rejects.toBe(thrown);

    expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioRunId: "prefetch-throws", error: thrown.message }),
    );
    expect(fixture.finishUnsuccessfulRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ cancelled: true }),
    );
  });

  it("releases the pool when preparation fails before a child starts", async () => {
    const fixture = processorFixture();
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve(null),
      result: Promise.resolve({ success: false, error: "scenario missing" }),
    });

    fixture.pool.submit(job("missing"));
    fixture.pool.submit(job("next"));

    await vi.waitFor(() => {
      expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledTimes(2);
    });
    expect(fixture.pool.activeCount).toBe(0);
    expect(fixture.pool.pendingCount).toBe(0);
  });

  it("aborts an early child when preparation rejects", async () => {
    const fixture = processorFixture();
    const result = deferred<ScenarioExecutionPrefetchResult>();
    const session = new TestChildSession();
    fixture.childProcesses.start = vi.fn().mockReturnValue(session);
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve({
        labels: [],
        telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
      }),
      result: result.promise,
    });

    const execution = fixture.processor.execute(job("rejected-prefetch"));
    await vi.waitFor(() => expect(fixture.childProcesses.start).toHaveBeenCalledOnce());
    result.reject(new Error("prefetch unavailable"));

    await expect(execution).rejects.toThrow("prefetch unavailable");
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.execute).not.toHaveBeenCalled();
  });

  /** @scenario "Child startup overlaps slow preparation" */
  it("aborts an early child when cancellation arrives during preparation", async () => {
    const fixture = processorFixture();
    const result = deferred<ScenarioExecutionPrefetchResult>();
    const session = new TestChildSession();
    fixture.childProcesses.start = vi.fn().mockReturnValue(session);
    fixture.execution.prepare = vi.fn().mockReturnValue({
      childEnvironment: Promise.resolve({
        labels: [],
        telemetry: { endpoint: "https://app.langwatch.ai", apiKey: "project-key" },
      }),
      result: result.promise,
    });

    const execution = fixture.processor.execute(job("cancel-during-prefetch"));
    await vi.waitFor(() => expect(fixture.childProcesses.start).toHaveBeenCalledOnce());
    fixture.pool.markCancelled("cancel-during-prefetch");

    result.resolve({ success: false, error: "ignored after cancellation" });
    await execution;

    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.execute).not.toHaveBeenCalled();
    expect(fixture.finishUnsuccessfulRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelled: true,
        error: "Cancelled before execution started",
      }),
    );
  });
});

describe("Scenario child process protocol", () => {
  it("extracts the final structured result from mixed stdout", () => {
    const stdout = [
      '{"level":30,"msg":"spawning"}',
      '{"success":false,"error":"self-signed certificate"}',
    ].join("\n");
    expect(parseChildProcessResult(stdout)).toEqual({
      success: false,
      error: "self-signed certificate",
    });
  });

  it("returns null when stdout contains only logs", () => {
    expect(parseChildProcessResult('{"level":30,"msg":"only logs"}')).toBeNull();
  });

  /** @scenario Pass labels to SDK for tracing */
  it("escapes labels in the resource attribute", () => {
    expect(buildOtelResourceAttributes(["support,tier=one"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support\\,tier\\=one",
    );
  });
});
