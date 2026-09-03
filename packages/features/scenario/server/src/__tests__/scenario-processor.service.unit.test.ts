import { ChildProcess } from "node:child_process";
import {
  ScenarioExecutionService,
  type ScenarioExecutionPrefetchResult,
} from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CancellationSubscriberPort,
  NodeScenarioChildProcessAdapter,
  ScenarioExecutionPoolService,
  ScenarioExecutionRunnerPort,
  ScenarioChildExecutionSession,
  ScenarioProcessorService,
  ScenarioProcessorServiceMetricsPort,
  buildOtelResourceAttributes,
  parseChildProcessResult,
  type CancellationMessage,
  type ExecutionJobData,
} from "../index";

const job = (id: string): ExecutionJobData => ({
  projectId: "project-1",
  scenarioId: `scenario-${id}`,
  scenarioRunId: id,
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "http", referenceId: "agent-1" },
});

class TestCancellationSubscriber extends CancellationSubscriberPort {
  private onCancellation: ((message: CancellationMessage) => void) | undefined = void 0;

  subscribe(
    onCancellation: (message: CancellationMessage) => void,
  ): Promise<() => Promise<void>> {
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

class TestMetrics extends ScenarioProcessorServiceMetricsPort {
  started(): void {}
  completed(): void {}
  failed(): void {}
}

class HoldingExecutionRunner extends ScenarioExecutionRunnerPort {
  constructor(
    private readonly pool: ScenarioExecutionPoolService,
    private readonly child: ChildProcess,
  ) {
    super();
  }

  execute(jobData: ExecutionJobData): Promise<void> {
    this.pool.registerChild(jobData.scenarioRunId, this.child);
    return Promise.resolve();
  }

  skipCancelled(): void {}
}

function processorFixture() {
  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  const execution = Object.create(
    ScenarioExecutionService.prototype,
  ) as ScenarioExecutionService;
  const childProcesses = Object.create(
    NodeScenarioChildProcessAdapter.prototype,
  ) as NodeScenarioChildProcessAdapter;
  const finishUnsuccessfulRun = vi.fn().mockResolvedValue(undefined);
  const cancellations = new TestCancellationSubscriber();
  execution.finishUnsuccessfulRun = finishUnsuccessfulRun;

  const processor = ScenarioProcessorService.create({
    execution,
    pool,
    cancellations,
    childProcesses,
    metrics: new TestMetrics(),
  });
  pool.connect(processor);
  return {
    processor,
    pool,
    execution,
    childProcesses,
    cancellations,
    finishUnsuccessfulRun,
  };
}

class TestChildSession extends ScenarioChildExecutionSession {
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
  describe("failed runs", () => {
    it("finishes with the complete run and target context", async () => {
      const fixture = processorFixture();

      await fixture.processor.handleFailed(job("run-1"), "Prefetch failed");

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
        fixture.processor.handleFailed(job("run-1"), "failed"),
      ).rejects.toThrow("write failed");
    });
  });

  describe("worker drain", () => {
    let fixture: ReturnType<typeof processorFixture>;
    let killSignals: Array<number | NodeJS.Signals | undefined>;

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

      const runIds = fixture.finishUnsuccessfulRun.mock.calls.map(
        ([input]) => input.scenarioRunId,
      );
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

  describe("cancellation subscription", () => {
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

  it("escapes labels in the resource attribute", () => {
    expect(buildOtelResourceAttributes(["support,tier=one"])).toBe(
      "langwatch.origin.source=platform,scenario.labels=support\\,tier\\=one",
    );
  });
});
