import type { HandlerContext, ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  deliverExperimentRunExecutionFailRun,
  EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
  EXPERIMENT_RUN_STALLED_CODE,
  handleExperimentRunCompleted,
  handleExperimentRunStarted,
  handleExperimentRunTargetResult,
  initExperimentRunExecutionState,
  onExperimentRunExecutionWake,
} from "./experimentRunExecution.process";

function ctx(overrides: Partial<ProcessContext> = {}): ProcessContext {
  return {
    now: 10_000,
    tenantId: "tenant-1",
    processKey: "exp-1:run-1",
    ...overrides,
  };
}

describe("experimentRunExecution process", () => {
  /** @scenario "Results keep a running experiment alive" */
  it("re-arms the deadline on every result, extending how long the run may go quiet", () => {
    const started = handleExperimentRunStarted(
      initExperimentRunExecutionState(),
      {
        runId: "run-1",
        experimentId: "exp-1",
        workflowVersionId: null,
        total: 1,
        targets: [],
        occurredAt: 10_000,
      },
      ctx(),
    );
    const next = handleExperimentRunTargetResult(
      started.state,
      {
        runId: "run-1",
        experimentId: "exp-1",
        index: 0,
        targetId: "t1",
        entry: {},
        occurredAt: 20_000,
      },
      ctx({ now: 20_000 }),
    );
    expect(next.nextWakeAt).toBe(20_000 + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS);
    expect(next.nextWakeAt).toBeGreaterThan(started.nextWakeAt!);
  });

  /** @scenario "A backlog does not end a healthy run" */
  it("schedules from now rather than a backlogged event's own past timestamp", () => {
    const step = handleExperimentRunTargetResult(
      initExperimentRunExecutionState(),
      {
        runId: "run-1",
        experimentId: "exp-1",
        index: 0,
        targetId: "t1",
        entry: {},
        occurredAt: 1_000,
      },
      ctx({ now: 50_000 }),
    );
    expect(step.nextWakeAt).toBe(50_000 + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS);
  });

  /** @scenario "An experiment run whose work disappears is ended" */
  it("fires a failRun intent naming the stalled run when its deadline wakes", () => {
    const started = handleExperimentRunStarted(
      initExperimentRunExecutionState(),
      {
        runId: "run-1",
        experimentId: "exp-1",
        workflowVersionId: null,
        total: 1,
        targets: [],
        occurredAt: 10_000,
      },
      ctx(),
    );
    const wake = onExperimentRunExecutionWake(
      started.state,
      ctx({ now: 99_999 }),
    );
    expect(wake.intents).toEqual([
      {
        type: "failRun",
        payload: {
          runId: "run-1",
          experimentId: "exp-1",
          stalledAt: 99_999,
          code: EXPERIMENT_RUN_STALLED_CODE,
        },
      },
    ]);
    expect(wake.state.settled).toBe(true);
    expect(wake.nextWakeAt).toBeNull();
  });

  /** @scenario "A completed run stops being watched" */
  it("clears the deadline once completed, and arms none afterwards", () => {
    const completed = handleExperimentRunCompleted(
      initExperimentRunExecutionState(),
      {
        runId: "run-1",
        experimentId: "exp-1",
        finishedAt: 5_000,
        stoppedAt: null,
      },
      ctx(),
    );
    expect(completed.nextWakeAt).toBeNull();
    expect(completed.state.settled).toBe(true);
  });

  /** @scenario "A late result cannot revive a completed run" */
  it("does not re-arm a deadline for a straggling result after settlement", () => {
    const completed = handleExperimentRunCompleted(
      initExperimentRunExecutionState(),
      {
        runId: "run-1",
        experimentId: "exp-1",
        finishedAt: 5_000,
        stoppedAt: null,
      },
      ctx(),
    );
    const late = handleExperimentRunTargetResult(
      completed.state,
      {
        runId: "run-1",
        experimentId: "exp-1",
        index: 0,
        targetId: "t1",
        entry: {},
        occurredAt: 999_999,
      },
      ctx({ now: 999_999 }),
    );
    expect(late.nextWakeAt).toBeNull();
  });

  /** @scenario "A run nothing is known about is abandoned rather than retried forever" */
  it("clears the wake with no intent when the process never learned which run it watches", () => {
    const wake = onExperimentRunExecutionWake(
      initExperimentRunExecutionState(),
      ctx({ processKey: "" }),
    );
    expect(wake.intents).toEqual([]);
    expect(wake.nextWakeAt).toBeNull();
  });

  /** @scenario "Watching a run does not copy what the run is about" */
  it("keeps only identities in state — no dataset row, model output or evaluator input", () => {
    const step = handleExperimentRunTargetResult(
      initExperimentRunExecutionState(),
      {
        runId: "run-1",
        experimentId: "exp-1",
        index: 0,
        targetId: "t1",
        entry: { question: "sensitive dataset row" },
        predicted: { answer: "model output" },
        occurredAt: 10_000,
      },
      ctx(),
    );
    expect(Object.keys(step.state).sort()).toEqual([
      "experimentId",
      "runId",
      "settled",
    ]);
  });

  describe("deliverExperimentRunExecutionFailRun", () => {
    const handlerCtx: HandlerContext = { now: 100_000, tenantId: "tenant-1" };

    /** @scenario "Ending a run stops it spending" */
    it("signals stop before recording the terminal state", async () => {
      const calls: string[] = [];
      const deps = {
        signalStop: vi.fn(async () => {
          calls.push("signalStop");
        }),
        completeRun: vi.fn(async () => {
          calls.push("completeRun");
        }),
        markRunFailed: vi.fn(async () => {
          calls.push("markRunFailed");
        }),
      };

      await deliverExperimentRunExecutionFailRun(
        {
          runId: "run-1",
          experimentId: "exp-1",
          stalledAt: 90_000,
          code: EXPERIMENT_RUN_STALLED_CODE,
        },
        handlerCtx,
        deps,
      );

      expect(calls).toEqual(["signalStop", "completeRun", "markRunFailed"]);
      expect(deps.completeRun).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          runId: "run-1",
          experimentId: "exp-1",
          finishedAt: null,
          stoppedAt: 90_000,
        }),
      );
    });

    /** @scenario "A stop that is never observed still ends the run" */
    it("still records the terminal state when the abort signal fails", async () => {
      const deps = {
        signalStop: vi.fn(async () => {
          throw new Error("no live process to signal");
        }),
        completeRun: vi.fn(async () => undefined),
        markRunFailed: vi.fn(async () => undefined),
      };

      await deliverExperimentRunExecutionFailRun(
        {
          runId: "run-1",
          experimentId: "exp-1",
          stalledAt: 90_000,
          code: EXPERIMENT_RUN_STALLED_CODE,
        },
        handlerCtx,
        deps,
      );

      expect(deps.completeRun).toHaveBeenCalled();
    });
  });
});
