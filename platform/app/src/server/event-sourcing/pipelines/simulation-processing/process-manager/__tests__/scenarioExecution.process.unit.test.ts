import { describe, expect, it } from "vitest";

import type { ProcessHandlerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  buildProcessEventView,
  handleCancelRequested,
  handleMessageSnapshot,
  handleQueued,
  handleSettled,
  handleStarted,
  scenarioExecutionWake,
} from "../scenarioExecution.process";
import {
  dispatchDeadlineMsFor,
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
  const factory = (intentType: string) => (key: string, payload: unknown) => ({
    messageKey: key,
    intentType,
    payload,
  });
  return {
    at: overrides.at ?? NOW,
    now: overrides.now ?? NOW,
    key: RUN_ID,
    projectId: "project-1",
    intents: {
      executeRun: factory("executeRun"),
      failRun: factory("failRun"),
    } as unknown as Intents,
  };
}

const TARGET = { type: "http", referenceId: "agent-1" } as const;

/** The identities every simulation event carries, as the payload view sees them. */
const IDENTITIES = {
  scenarioRunId: RUN_ID,
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  target: null,
};

/** What a `queued` event carries: identities plus what to execute. */
const QUEUED_PAYLOAD = { ...IDENTITIES, target: TARGET };

/** A committed `queued` event, as the pipeline hands it to the payload view. */
function queuedEvent(data: Record<string, unknown>): SimulationProcessingEvent {
  return {
    data: {
      scenarioRunId: RUN_ID,
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      ...data,
    },
  } as unknown as SimulationProcessingEvent;
}

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
    /** @scenario "A queued run is given time to be picked up" */
    it("arms a dispatch deadline", () => {
      const result = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        QUEUED_PAYLOAD,
        makeCtx(),
      );

      expect(result.nextWakeAt).toBe(NOW + SCENARIO_DISPATCH_DEADLINE_MS);
    });

    it("records the identities a terminal write will need", () => {
      const result = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        QUEUED_PAYLOAD,
        makeCtx(),
      );

      expect(result.state).toMatchObject({
        scenarioRunId: RUN_ID,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
      });
    });

    /**
     * The heart of step 2. The predecessor called `pool.submit()` from a
     * reactor, fire-and-forget into an in-RAM overflow array; here the
     * dispatch is committed with the inbox row, so a worker that dies between
     * consuming the event and starting the child no longer loses the run.
     */
    it("enqueues the dispatch alongside the deadline", () => {
      const result = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        QUEUED_PAYLOAD,
        makeCtx(),
      );

      expect(result.intents).toHaveLength(1);
      expect(result.intents?.[0]?.intentType).toBe("executeRun");
      expect(result.intents?.[0]?.payload).toMatchObject({
        projectId: "project-1",
        scenarioRunId: RUN_ID,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
        target: TARGET,
      });
    });

    it("addresses the dispatch by a key derived from the run", () => {
      const first = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        QUEUED_PAYLOAD,
        makeCtx(),
      );
      const redelivered = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        QUEUED_PAYLOAD,
        makeCtx({ at: NOW + 5_000, now: NOW + 5_000 }),
      );

      // The outbox skips a duplicate message key on insert, so deriving the
      // key from the run — rather than minting one per attempt — is what
      // makes a redelivered `queued` enqueue one execution, not two.
      expect(first.intents?.[0]?.messageKey).toBe(
        redelivered.intents?.[0]?.messageKey,
      );
      expect(first.intents?.[0]?.messageKey).toContain(RUN_ID);
    });
  });

  describe("given a queued run carries no target", () => {
    it("arms the deadline but enqueues nothing", () => {
      const result = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        IDENTITIES,
        makeCtx(),
      );

      // Nothing can be executed, so there is nothing for the outbox to retry.
      // The armed deadline is what ends the run instead.
      expect(result.intents ?? []).toEqual([]);
      expect(result.nextWakeAt).toBe(NOW + SCENARIO_DISPATCH_DEADLINE_MS);
    });
  });

  describe("given a queued event arrives after the run already ended", () => {
    it("does not enqueue a dispatch for it", () => {
      const settled = handleSettled(known(), IDENTITIES, makeCtx());

      const late = handleQueued(
        settled.state,
        QUEUED_PAYLOAD,
        makeCtx({ at: NOW + 1_000, now: NOW + 1_000 }),
      );

      expect(late.intents ?? []).toEqual([]);
      expect(late.nextWakeAt).toBeNull();
    });
  });

  /**
   * The tail of a large batch waits behind every sibling ahead of it, and that
   * wait is healthy. A fixed queued window would terminalise it before it ever
   * ran, which is the one case where this process manager can be actively
   * wrong rather than merely late.
   */
  describe("given the run queued as part of a large batch", () => {
    describe("when the dispatch deadline is armed", () => {
      /** @scenario "A run waiting behind a big batch is not mistaken for a dead one" */
      it("gives it more room than a run that queued alone", () => {
        const alone = handleQueued(
          INITIAL_SCENARIO_EXECUTION_STATE,
          { ...IDENTITIES, batchTotal: 1 },
          makeCtx(),
        );
        const inBatch = handleQueued(
          INITIAL_SCENARIO_EXECUTION_STATE,
          { ...IDENTITIES, batchTotal: 500 },
          makeCtx(),
        );

        expect(inBatch.nextWakeAt!).toBeGreaterThan(alone.nextWakeAt!);
      });

      it("falls back to the floor when the batch never said how big it is", () => {
        const result = handleQueued(
          INITIAL_SCENARIO_EXECUTION_STATE,
          IDENTITIES,
          makeCtx(),
        );

        expect(result.nextWakeAt).toBe(NOW + SCENARIO_DISPATCH_DEADLINE_MS);
      });

      it("caps the allowance so a bad denominator cannot arm a deadline years out", () => {
        expect(dispatchDeadlineMsFor(Number.MAX_SAFE_INTEGER)).toBe(
          dispatchDeadlineMsFor(10_000_000),
        );
      });
    });
  });

  /**
   * The handler only ever sees the narrowed view, so a denominator the view
   * drops is a denominator the deadline cannot use — silently, and looking
   * exactly like a batch that never carried one. These go through
   * `buildProcessEventView` for that reason rather than handing the handler a
   * payload it would never receive in production.
   */
  describe("given a queued event carrying the batch denominator", () => {
    describe("when it is narrowed for the process manager", () => {
      it("carries the denominator through to the deadline", () => {
        const view = buildProcessEventView(queuedEvent({ batchTotal: 500 }));

        expect(
          handleQueued(INITIAL_SCENARIO_EXECUTION_STATE, view, makeCtx())
            .nextWakeAt,
        ).toBe(NOW + dispatchDeadlineMsFor(500));
      });

      it("leaves conversation content on the far side of the narrowing", () => {
        const view = buildProcessEventView(
          queuedEvent({ batchTotal: 2, messages: [{ content: "secret" }] }),
        );

        expect(view).not.toHaveProperty("messages");
      });

      it("degrades a malformed denominator to an unknown batch size", () => {
        const view = buildProcessEventView(queuedEvent({ batchTotal: -3 }));

        expect(
          handleQueued(INITIAL_SCENARIO_EXECUTION_STATE, view, makeCtx())
            .nextWakeAt,
        ).toBe(NOW + SCENARIO_DISPATCH_DEADLINE_MS);
      });
    });
  });

  describe("given a run is making progress", () => {
    /** @scenario "A run that keeps reporting is left alone" */
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
    /** @scenario "A backlog does not kill a healthy run" */
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

    /** @scenario "A cancelled run nobody honoured is still ended" */
    it("finalises as cancelled when the grace expires", () => {
      const armed = handleCancelRequested(known(), IDENTITIES, makeCtx());

      const woken = scenarioExecutionWake(armed.state, makeCtx());

      expect(woken.intents?.[0]?.payload).toMatchObject({
        outcome: "cancelled",
      });
    });

    /**
     * A child routinely finishes streaming its current message before it
     * honours SIGTERM, so progress events after a cancel are the normal case,
     * not an edge one. They run through the progress handlers, which ask for
     * the 30-minute window — taking it would push the cancelled run's deadline
     * back out by half an hour and strand it exactly as long as never having
     * cancelled.
     */
    it.each([
      ["a snapshot", handleMessageSnapshot],
      ["a start", handleStarted],
    ])("keeps the cancel grace when %s lands afterwards", (_label, handle) => {
      const cancelled = handleCancelRequested(known(), IDENTITIES, makeCtx());

      const later = handle(cancelled.state, IDENTITIES, makeCtx());

      expect(later.nextWakeAt).toBe(NOW + SCENARIO_CANCEL_DEADLINE_MS);
      expect(later.nextWakeAt).not.toBe(NOW + SCENARIO_PROGRESS_DEADLINE_MS);
    });

    it("still finalises as cancelled after that progress event", () => {
      const cancelled = handleCancelRequested(known(), IDENTITIES, makeCtx());
      const later = handleMessageSnapshot(
        cancelled.state,
        IDENTITIES,
        makeCtx(),
      );

      const woken = scenarioExecutionWake(later.state, makeCtx());

      expect(woken.intents?.[0]?.payload).toMatchObject({
        outcome: "cancelled",
      });
    });
  });

  describe("given a run reached a terminal state on its own", () => {
    it("clears the deadline", () => {
      const result = handleSettled(known(), IDENTITIES, makeCtx());

      expect(result.nextWakeAt).toBeNull();
      expect(result.state.settled).toBe(true);
    });

    /** @scenario "A late report cannot revive a finished run" */
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

    /** @scenario "A run that finished on its own is never reaped" */
    /** @scenario "A deleted run stops being watched" */
    it("writes nothing when a wake fires against it anyway", () => {
      const settled = handleSettled(known(), IDENTITIES, makeCtx());

      const woken = scenarioExecutionWake(settled.state, makeCtx());

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });

  describe("when the deadline fires on a live-looking run", () => {
    /** @scenario "A run whose worker disappears is recorded as failed" */
    it("writes the terminal state", () => {
      const woken = scenarioExecutionWake(known(), makeCtx());

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toMatchObject({
        projectId: "project-1",
        scenarioRunId: RUN_ID,
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
      });
    });

    /**
     * Step 1 wrote ERROR here, because a stored STALLED would have disagreed
     * with the read-time derivation that was still live. That derivation is
     * gone, so the stall is now written once instead of being recomputed —
     * and therefore possibly answered differently — on every read.
     */
    it("records the stall as a stored fact", () => {
      const woken = scenarioExecutionWake(known(), makeCtx());

      expect(woken.intents?.[0]?.payload).toMatchObject({
        outcome: "stalled",
      });
    });

    it("says what the reason was, not just that it failed", () => {
      const woken = scenarioExecutionWake(known(), makeCtx());

      expect(woken.intents?.[0]?.payload).toMatchObject({
        reason: expect.stringContaining("no longer alive"),
      });
    });

    /**
     * The run whose dispatch never happened: `queued` armed the deadline and
     * enqueued an execution that nothing ever leased, so no `started` and no
     * progress event ever folded. The wake still ends it.
     */
    it("ends a run that never got past queued", () => {
      const queued = handleQueued(
        INITIAL_SCENARIO_EXECUTION_STATE,
        QUEUED_PAYLOAD,
        makeCtx(),
      );

      const woken = scenarioExecutionWake(
        queued.state,
        makeCtx({ at: NOW + SCENARIO_DISPATCH_DEADLINE_MS }),
      );

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toMatchObject({
        scenarioRunId: RUN_ID,
        outcome: "stalled",
      });
    });

    it("clears its own deadline so it cannot fire twice", () => {
      const woken = scenarioExecutionWake(known(), makeCtx());

      expect(woken.nextWakeAt).toBeNull();
      expect(woken.state.settled).toBe(true);

      const second = scenarioExecutionWake(woken.state, makeCtx());
      expect(second.intents ?? []).toEqual([]);
    });

    /** @scenario "Recording the death twice records it once" */
    it("addresses the write by the same key every time", () => {
      const a = scenarioExecutionWake(known(), makeCtx());
      const b = scenarioExecutionWake(known(), makeCtx({ now: NOW + 5000 }));

      // A stable message key is what lets the outbox collapse a duplicate.
      expect(a.intents?.[0]?.messageKey).toBe(b.intents?.[0]?.messageKey);
    });
  });

  describe("given the process never learned who the run belongs to", () => {
    /** @scenario "A run nothing is known about is abandoned rather than retried forever" */
    it("clears itself instead of being re-found forever", () => {
      const woken = scenarioExecutionWake(
        INITIAL_SCENARIO_EXECUTION_STATE,
        makeCtx(),
      );

      expect(woken.intents ?? []).toEqual([]);
      expect(woken.nextWakeAt).toBeNull();
    });
  });

  /**
   * The run reported progress but never a start.
   *
   * Only `queued` and `started` carry the scenario id — the placement fields the
   * progress events gained carry the batch and the set and nothing else — so
   * this instance knows exactly where the run belongs and not what it is. It was
   * once refused a terminal write for that, which is the worst of both outcomes:
   * the wake cleared instead of retrying, and with nothing deriving a stall at
   * read time any more the run displayed as IN_PROGRESS for good.
   */
  describe("given the run was only ever described by its progress reports", () => {
    function fromSnapshotsAlone() {
      // What a snapshot narrows to: the run and its placement, no scenario id.
      const snapshotView = {
        scenarioRunId: RUN_ID,
        scenarioId: null,
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        target: null,
      };
      return handleMessageSnapshot(
        INITIAL_SCENARIO_EXECUTION_STATE,
        snapshotView,
        makeCtx(),
      ).state;
    }

    it("learns the placement but not the scenario", () => {
      expect(fromSnapshotsAlone()).toMatchObject({
        scenarioId: "",
        batchRunId: "batch-1",
        setId: "set-1",
      });
    });

    describe("when its deadline fires", () => {
      /** @scenario "A run known only from its progress reports is still ended" */
      it("records the terminal state anyway", () => {
        const woken = scenarioExecutionWake(fromSnapshotsAlone(), makeCtx());

        expect(woken.intents).toHaveLength(1);
        expect(woken.intents?.[0]?.payload).toMatchObject({
          scenarioRunId: RUN_ID,
          batchRunId: "batch-1",
          setId: "set-1",
          outcome: "stalled",
        });
        expect(woken.state.settled).toBe(true);
      });

      it("writes it without a scenario id rather than not at all", () => {
        const woken = scenarioExecutionWake(fromSnapshotsAlone(), makeCtx());

        // The scenario id only fetches the display fields a reaped run is
        // decorated with, and that read is best-effort on the far side of this
        // intent. It is not what addresses the run.
        expect(woken.intents?.[0]?.payload).toMatchObject({ scenarioId: "" });
      });
    });
  });
});
