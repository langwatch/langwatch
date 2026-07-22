import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import {
  handleCancelRequested,
  handleMessageSnapshot,
  handleQueued,
  handleSettled,
  handleStarted,
  scenarioExecutionWake,
} from "../scenarioExecution.process";
import {
  INITIAL_SCENARIO_EXECUTION_STATE,
  SCENARIO_CANCEL_DEADLINE_MS,
  SCENARIO_DISPATCH_DEADLINE_MS,
  SCENARIO_PROGRESS_DEADLINE_MS,
  type ScenarioExecutionState,
} from "../scenarioExecutionProcess.types";

const RUN_ID = "run-1";
const NOW = 1_700_000_000_000;

type Intents = Parameters<typeof scenarioExecutionWake>[1]["intents"];

function makeCtx(
  overrides: { at?: number; now?: number } = {},
): ProcessHandlerContext<any> {
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: RUN_ID,
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

/** The identities every simulation event carries, as the payload view sees them. */
const IDENTITIES = {
  scenarioRunId: RUN_ID,
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
};

function known(
  overrides: Partial<ScenarioExecutionState> = {},
): ScenarioExecutionState {
  return {
    ...INITIAL_SCENARIO_EXECUTION_STATE,
    scenarioRunId: RUN_ID,
    scenarioId: "scenario-1",
    batchRunId: "batch-1",
    setId: "set-1",
    ...overrides,
  };
}

describe("scenarioExecution process", () => {
  describe("given a run is queued", () => {
    it("arms a dispatch deadline", () => {
      const result = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      expect(result.nextWakeAt).toBe(NOW + SCENARIO_DISPATCH_DEADLINE_MS);
    });

    it("records the identities a terminal write will need", () => {
      const result = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      expect(result.state).toMatchObject({
        scenarioRunId: RUN_ID,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
      });
    });
  });

  describe("given a run is making progress", () => {
    it("pushes the deadline out on every event", () => {
      const started = handleStarted(known(), IDENTITIES, makeCtx());
      const later = makeCtx({ at: NOW + 60_000, now: NOW + 60_000 });
      const snapshot = handleMessageSnapshot(
        started.state,
        IDENTITIES,
        later,
      );

      expect(started.nextWakeAt).toBe(NOW + SCENARIO_PROGRESS_DEADLINE_MS);
      expect(snapshot.nextWakeAt).toBe(
        NOW + 60_000 + SCENARIO_PROGRESS_DEADLINE_MS,
      );
    });

    it("keeps identities an event omitted", () => {
      const result = handleMessageSnapshot(
        known(),
        // A snapshot carries the run id but not the batch or set.
        { scenarioRunId: RUN_ID, scenarioId: null, batchRunId: null, scenarioSetId: null },
        makeCtx(),
      );

      expect(result.state).toMatchObject({
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
      });
    });
  });

  describe("given the subscriber is backed up", () => {
    it("schedules from now, not from the event's own instant", () => {
      const lagged = makeCtx({ at: NOW - 60 * 60 * 1000, now: NOW });

      const result = handleStarted(known(), IDENTITIES, lagged);

      // Scheduling from `at` would put the deadline an hour in the past and
      // fire a wake against a run that is in fact healthy.
      expect(result.nextWakeAt).toBe(NOW + SCENARIO_PROGRESS_DEADLINE_MS);
    });
  });

  describe("given a cancel was requested", () => {
    it("arms the shorter cancel grace", () => {
      const result = handleCancelRequested(known(), IDENTITIES, makeCtx());

      expect(result.nextWakeAt).toBe(NOW + SCENARIO_CANCEL_DEADLINE_MS);
    });

    it("finalises as cancelled when the grace expires", () => {
      const armed = handleCancelRequested(known(), IDENTITIES, makeCtx());

      const woken = scenarioExecutionWake(armed.state, makeCtx());

      expect(woken.intents?.[0]?.payload).toMatchObject({ cancelled: true });
    });
  });

  describe("given a run reached a terminal state on its own", () => {
    it("clears the deadline", () => {
      const result = handleSettled(known(), IDENTITIES, makeCtx());

      expect(result.nextWakeAt).toBeNull();
      expect(result.state.settled).toBe(true);
    });

    it("is not re-armed by a straggling progress event", () => {
      const settled = handleSettled(known(), IDENTITIES, makeCtx());

      const straggler = handleMessageSnapshot(
        settled.state,
        IDENTITIES,
        makeCtx({ at: NOW + 1000, now: NOW + 1000 }),
      );

      // A child that outlived its own `finished` event must not resurrect a
      // finished run as failed.
      expect(straggler.nextWakeAt).toBeNull();
    });

    it("writes nothing when a wake fires against it anyway", () => {
      const settled = handleSettled(known(), IDENTITIES, makeCtx());

      const woken = scenarioExecutionWake(settled.state, makeCtx());

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });

  describe("when the deadline fires on a live-looking run", () => {
    it("writes the terminal state", () => {
      const woken = scenarioExecutionWake(known(), makeCtx());

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toMatchObject({
        projectId: "project-1",
        scenarioRunId: RUN_ID,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
        cancelled: false,
      });
    });

    it("clears its own deadline so it cannot fire twice", () => {
      const woken = scenarioExecutionWake(known(), makeCtx());

      expect(woken.nextWakeAt).toBeNull();
      expect(woken.state.settled).toBe(true);

      const second = scenarioExecutionWake(woken.state, makeCtx());
      expect(second.intents ?? []).toEqual([]);
    });

    it("addresses the write by the same key every time", () => {
      const a = scenarioExecutionWake(known(), makeCtx());
      const b = scenarioExecutionWake(known(), makeCtx({ now: NOW + 5000 }));

      // A stable message key is what lets the outbox collapse a duplicate.
      expect(a.intents?.[0]?.messageKey).toBe(b.intents?.[0]?.messageKey);
    });
  });

  describe("given the process never learned who the run belongs to", () => {
    it("clears itself instead of being re-found forever", () => {
      const woken = scenarioExecutionWake(
        INITIAL_SCENARIO_EXECUTION_STATE,
        makeCtx(),
      );

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });
});
