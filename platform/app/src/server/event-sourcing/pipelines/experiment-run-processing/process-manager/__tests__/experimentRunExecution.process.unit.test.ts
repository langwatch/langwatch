import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  buildProcessEventView,
  experimentRunExecutionWake,
  handleCompleted,
  handleEvaluatorResult,
  handleStarted,
  handleTargetResult,
} from "../experimentRunExecution.process";
import {
  EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
  INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
  type ExperimentRunExecutionState,
} from "../experimentRunExecutionProcess.types";

const RUN_ID = "hypnotic-persimmon-turkey";
const EXPERIMENT_ID = "experiment-1";
/** The process key IS the aggregate id: `experimentId:runId`. */
const PROCESS_KEY = `${EXPERIMENT_ID}:${RUN_ID}`;
const NOW = 1_700_000_000_000;

type Intents = Parameters<typeof experimentRunExecutionWake>[1]["intents"];

function makeCtx(
  overrides: { at?: number; now?: number; key?: string } = {},
): ProcessHandlerContext<any> {
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: overrides.key ?? PROCESS_KEY,
    projectId: "project-1",
    intents: {
      failRun: (key: string, payload: unknown) => ({
        messageKey: key,
        intentType: "failRun",
        payload,
      }),
    } as unknown as Intents,
  };
}

/** The identities every experiment-run event carries, as the payload view sees them. */
const IDENTITIES = { runId: RUN_ID, experimentId: EXPERIMENT_ID };

function known(
  overrides: Partial<ExperimentRunExecutionState> = {},
): ExperimentRunExecutionState {
  return {
    ...INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
    runId: RUN_ID,
    experimentId: EXPERIMENT_ID,
    ...overrides,
  };
}

describe("experimentRunExecution process", () => {
  describe("given a run is producing results", () => {
    /** @scenario "Results keep a running experiment alive" */
    it("pushes the deadline out on every result", () => {
      const started = handleStarted(
        INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      // A run that keeps talking for longer than the window still never has a
      // deadline behind it, because each result moves the deadline itself.
      const past = EXPERIMENT_RUN_PROGRESS_DEADLINE_MS + 60_000;
      const target = handleTargetResult(
        started.state,
        IDENTITIES,
        makeCtx({ at: NOW + past, now: NOW + past }),
      );
      const evaluator = handleEvaluatorResult(
        target.state,
        IDENTITIES,
        makeCtx({ at: NOW + past + 1_000, now: NOW + past + 1_000 }),
      );

      expect(started.nextWakeAt).toBe(NOW + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS);
      expect(target.nextWakeAt).toBe(
        NOW + past + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
      );
      expect(evaluator.nextWakeAt).toBe(
        NOW + past + 1_000 + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
      );
    });

    it("records the identities a terminal write will need", () => {
      const result = handleStarted(
        INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      expect(result.state).toMatchObject({
        runId: RUN_ID,
        experimentId: EXPERIMENT_ID,
      });
    });

    it("recovers the identities from the process key when an event omits them", () => {
      const result = handleTargetResult(
        INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
        { runId: null, experimentId: null },
        makeCtx(),
      );

      expect(result.state).toMatchObject({
        runId: RUN_ID,
        experimentId: EXPERIMENT_ID,
      });
    });
  });

  describe("given the subscriber is backed up", () => {
    /** @scenario "A backlog does not end a healthy run" */
    it("schedules from now, not from the event's own instant", () => {
      const lagged = makeCtx({ at: NOW - 60 * 60 * 1000, now: NOW });

      const result = handleTargetResult(known(), IDENTITIES, lagged);

      // Scheduling from `at` would put the deadline an hour in the past and
      // fire a wake against a run that is in fact healthy.
      expect(result.nextWakeAt).toBe(NOW + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS);
    });
  });

  describe("when the work behind a run disappears", () => {
    /** @scenario "An experiment run whose work disappears is ended" */
    it("writes the terminal state when the deadline fires", () => {
      const armed = handleStarted(
        INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      const fired = experimentRunExecutionWake(
        armed.state,
        makeCtx({ now: NOW + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS }),
      );

      expect(fired.intents).toHaveLength(1);
      expect(fired.intents?.[0]?.payload).toMatchObject({
        projectId: "project-1",
        runId: RUN_ID,
        experimentId: EXPERIMENT_ID,
        stalledAt: NOW + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS,
      });
    });

    /** @scenario "An experiment run whose work disappears is ended" */
    it("reaps a run that only ever announced itself", () => {
      // An interactive run streams to a browser and is otherwise
      // indistinguishable on the event stream: same `started`, same results.
      // One that dies before its first result has only `started` folded, and
      // must still reach a terminal state rather than stay reported as running.
      const onlyStarted = handleStarted(
        INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      const fired = experimentRunExecutionWake(onlyStarted.state, makeCtx());

      expect(fired.intents).toHaveLength(1);
      expect(fired.state.settled).toBe(true);
    });

    /** @scenario "A stop that is never observed still ends the run" */
    it("ends a run nobody honoured, on the ordinary silence window", () => {
      // Nothing tells this process a stop was asked for — the abort request is
      // a Redis flag and emits no event — so a stop nobody is alive to honour
      // is simply a run that goes quiet, and the same deadline ends it.
      const armed = handleTargetResult(known(), IDENTITIES, makeCtx());

      const fired = experimentRunExecutionWake(
        armed.state,
        makeCtx({ now: NOW + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS }),
      );

      expect(fired.intents).toHaveLength(1);
      expect(fired.nextWakeAt).toBeNull();
    });

    it("clears its own deadline so it cannot fire twice", () => {
      const fired = experimentRunExecutionWake(known(), makeCtx());

      expect(fired.nextWakeAt).toBeNull();
      expect(fired.state.settled).toBe(true);

      const second = experimentRunExecutionWake(fired.state, makeCtx());
      expect(second.intents ?? []).toEqual([]);
    });

    /** @scenario "Recording the outcome twice records it once" */
    it("addresses the write by the same key every time", () => {
      const a = experimentRunExecutionWake(known(), makeCtx());
      const b = experimentRunExecutionWake(known(), makeCtx({ now: NOW + 5000 }));

      // A stable message key is what lets the outbox collapse a duplicate.
      expect(a.intents?.[0]?.messageKey).toBe(b.intents?.[0]?.messageKey);
    });
  });

  describe("given a run reached a terminal state on its own", () => {
    /** @scenario "A completed run stops being watched" */
    it("clears the deadline and is not reaped afterwards", () => {
      const completed = handleCompleted(known(), IDENTITIES, makeCtx());

      expect(completed.nextWakeAt).toBeNull();
      expect(completed.state.settled).toBe(true);

      const fired = experimentRunExecutionWake(
        completed.state,
        makeCtx({ now: NOW + EXPERIMENT_RUN_PROGRESS_DEADLINE_MS }),
      );

      expect(fired.intents ?? []).toEqual([]);
      expect(fired.nextWakeAt).toBeNull();
    });

    /** @scenario "A late result cannot revive a completed run" */
    it("is not re-armed by a straggling result", () => {
      const completed = handleCompleted(known(), IDENTITIES, makeCtx());

      const straggler = handleEvaluatorResult(
        completed.state,
        IDENTITIES,
        makeCtx({ at: NOW + 1_000, now: NOW + 1_000 }),
      );

      // A cell that outlived the run's own completion must not resurrect a
      // finished run as failed.
      expect(straggler.nextWakeAt).toBeNull();
    });
  });

  describe("given the process never learned which run it watches", () => {
    /** @scenario "A run nothing is known about is abandoned rather than retried forever" */
    it("clears itself instead of being re-found forever", () => {
      const fired = experimentRunExecutionWake(
        INITIAL_EXPERIMENT_RUN_EXECUTION_STATE,
        makeCtx({ key: "" }),
      );

      expect(fired.intents ?? []).toEqual([]);
      expect(fired.nextWakeAt).toBeNull();
    });
  });

  describe("when an event is narrowed to the payload the process may see", () => {
    /** @scenario "Watching a run does not copy what the run is about" */
    it("keeps the identities and drops everything else", () => {
      const view = buildProcessEventView({
        type: "lw.experiment_run.target_result",
        data: {
          runId: RUN_ID,
          experimentId: EXPERIMENT_ID,
          index: 3,
          targetId: "target-1",
          entry: { question: "what is my account balance" },
          predicted: { output: "it is 42 dollars" },
          error: "provider returned 500: key sk-live-abc",
        },
      } as any);

      // The payload is persisted verbatim into process state and outbox rows.
      // Dataset rows, model outputs and failure text must never get there.
      expect(view).toEqual({ runId: RUN_ID, experimentId: EXPERIMENT_ID });
    });

    it("keeps the identities off an evaluator result too", () => {
      const view = buildProcessEventView({
        type: "lw.experiment_run.evaluator_result",
        data: {
          runId: RUN_ID,
          experimentId: EXPERIMENT_ID,
          index: 3,
          targetId: "target-1",
          evaluatorId: "evaluator-1",
          status: "processed",
          score: 0.8,
          details: "the answer disclosed the customer's balance",
          inputs: { input: "what is my account balance" },
        },
      } as any);

      expect(view).toEqual({ runId: RUN_ID, experimentId: EXPERIMENT_ID });
    });
  });
});
