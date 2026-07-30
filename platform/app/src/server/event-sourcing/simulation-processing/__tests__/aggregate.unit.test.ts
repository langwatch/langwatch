import { describe, expect, it } from "vitest";
import { outranksStoredTerminal, simulationRun } from "../aggregate";
import { initSimulationRunState, type SimulationRunState } from "../schema";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */

function fold(
  events: ReturnType<typeof simulationRun.events.queued>[],
): SimulationRunState {
  return events.reduce(
    (state, event) => simulationRun.apply(state, event) as SimulationRunState,
    simulationRun.init(),
  );
}

const BASE_QUEUED = {
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  occurredAt: 1,
};

const BASE_STARTED = {
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  occurredAt: 2,
};

describe("simulation_run aggregate", () => {
  describe("given the aggregate declaration", () => {
    it("derives every event's type string from the aggregate name", () => {
      expect([...simulationRun.eventTypes].sort()).toEqual(
        [
          "simulation_run/queued",
          "simulation_run/started",
          "simulation_run/messageSnapshot",
          "simulation_run/textMessageStart",
          "simulation_run/textMessageEnd",
          "simulation_run/finished",
          "simulation_run/metricsRecorded",
          "simulation_run/cancelRequested",
          "simulation_run/deleted",
        ].sort(),
      );
    });
  });

  // ---------------------------------------------------------------------
  // Defect 1 — a cancelled run must never be resurrected as SUCCESS
  // ---------------------------------------------------------------------
  describe("given terminal status authority", () => {
    /** @scenario "A cancel outranks a success that lands after it" */
    it("keeps a run cancelled when a success arrives afterwards", () => {
      const cancelledFirst = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({ status: "CANCELLED", occurredAt: 10 }),
      ]);

      const withLateSuccess = simulationRun.apply(
        cancelledFirst,
        simulationRun.events.finished({
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 20,
        }),
      ) as SimulationRunState;

      expect(withLateSuccess.status).toBe("CANCELLED");
      expect(withLateSuccess.finishedAt).toBe(10);
    });

    /** @scenario "A cancel delivered after the success it overrode still wins" */
    it("shows the run as cancelled when the cancel arrives after the success", () => {
      const succeededFirst = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 10,
        }),
      ]);

      const withLateCancel = simulationRun.apply(
        succeededFirst,
        simulationRun.events.finished({ status: "CANCELLED", occurredAt: 20 }),
      ) as SimulationRunState;

      expect(withLateCancel.status).toBe("CANCELLED");
    });

    /** @scenario "Two terminal declarations of equal authority keep the first" */
    it("keeps the first success when a second one is folded", () => {
      const firstFinish = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({
          results: {
            verdict: "success",
            reasoning: "first",
            metCriteria: [],
            unmetCriteria: [],
          },
          occurredAt: 10,
        }),
      ]);

      const afterSecond = simulationRun.apply(
        firstFinish,
        simulationRun.events.finished({
          results: {
            verdict: "success",
            reasoning: "second",
            metCriteria: [],
            unmetCriteria: [],
          },
          occurredAt: 20,
        }),
      ) as SimulationRunState;

      expect(afterSecond.reasoning).toBe("first");
      expect(afterSecond.finishedAt).toBe(10);
    });

    /** @scenario "A genuine outcome supersedes a provisional stall" */
    it("takes a stalled run back to successful when a real outcome lands", () => {
      const stalled = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({ status: "STALLED", occurredAt: 10 }),
      ]);

      const recovered = simulationRun.apply(
        stalled,
        simulationRun.events.finished({
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 20,
        }),
      ) as SimulationRunState;

      expect(recovered.status).toBe("SUCCESS");
    });

    /** @scenario "A late start does not resurrect a cancelled run" */
    it("leaves a cancelled run cancelled when started is delivered late", () => {
      const cancelled = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({ status: "CANCELLED", occurredAt: 10 }),
      ]);

      const afterLateStart = simulationRun.apply(
        cancelled,
        simulationRun.events.started(BASE_STARTED),
      ) as SimulationRunState;

      expect(afterLateStart.status).toBe("CANCELLED");
      expect(afterLateStart.finishedAt).toBe(10);
    });

    it("compares generation before rank, so a higher generation always wins", () => {
      // Forward-compatibility for a rerun mechanism ADR-098 decision 4 names
      // and ADR-103 decision 6 says is latent — ambiguous today because
      // nothing bumps generation yet, so this exercises the comparison
      // function directly rather than a reachable event path.
      expect(
        outranksStoredTerminal(
          { generation: 0, status: "CANCELLED" },
          { generation: 1, status: "FAILURE" },
        ),
      ).toBe(true);
      expect(
        outranksStoredTerminal(
          { generation: 1, status: "CANCELLED" },
          { generation: 0, status: "SUCCESS" },
        ),
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Order-invariance
  // ---------------------------------------------------------------------
  describe("given order-invariant handlers", () => {
    /** @scenario "A late queue event does not put a finished run back in the queue" */
    it("stays failed when a queued event is delivered after finished", () => {
      const failed = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({ status: "ERROR", occurredAt: 10 }),
      ]);

      const afterLateQueue = simulationRun.apply(
        failed,
        simulationRun.events.queued(BASE_QUEUED),
      ) as SimulationRunState;

      expect(afterLateQueue.status).toBe("ERROR");
    });

    /** @scenario "A snapshot older than the latest applied one is ignored" */
    it("ignores a snapshot older than the latest one already applied", () => {
      const withSnapshot = simulationRun.apply(
        initSimulationRunState(),
        simulationRun.events.messageSnapshot({
          messages: [{ id: "m1", role: "user", content: "hello" }],
          traceIds: [],
          occurredAt: 100,
        }),
      ) as SimulationRunState;

      const afterOlderSnapshot = simulationRun.apply(
        withSnapshot,
        simulationRun.events.messageSnapshot({
          messages: [{ id: "m0", role: "user", content: "stale" }],
          traceIds: [],
          occurredAt: 50,
        }),
      ) as SimulationRunState;

      expect(afterOlderSnapshot.messages).toEqual(withSnapshot.messages);
    });

    /** @scenario "A run measured under a retired event type keeps its cost on replay" */
    it("no-ops on an event type it was not built to handle", () => {
      const measured = simulationRun.apply(
        initSimulationRunState(),
        simulationRun.events.metricsRecorded({
          traceIds: ["trace-1"],
          totalCost: 1.5,
          roleCosts: { agent: [1.5] },
          roleLatencies: { agent: [200] },
        }),
      ) as SimulationRunState;

      const afterRetiredEvent = simulationRun.apply(measured, {
        type: "simulation_run/metricsComputed",
        data: {
          scenarioRunId: "x",
          traceId: "t",
          totalCost: 0,
          roleCosts: {},
          roleLatencies: {},
        },
      });

      expect(afterRetiredEvent).toEqual(measured);
      expect(afterRetiredEvent.totalCost).toBe(1.5);
    });
  });

  // ---------------------------------------------------------------------
  // ADR-103 — batch total travels with the run, established once
  // ---------------------------------------------------------------------
  describe("given ADR-103's batch denominator", () => {
    /** @scenario "Every run declares the batch total it was dispatched against" */
    it("carries the batch total from the queued event", () => {
      const state = fold([
        simulationRun.events.queued({ ...BASE_QUEUED, batchTotal: 5 }),
      ]);
      expect(state.batchTotal).toBe(5);
    });

    /** @scenario "A batch total established once is not erased by a later empty value" */
    it("keeps a known batch total when a redelivered queued omits it", () => {
      const withTotal = fold([
        simulationRun.events.queued({ ...BASE_QUEUED, batchTotal: 5 }),
      ]);

      const afterRedelivery = simulationRun.apply(
        withTotal,
        simulationRun.events.queued(BASE_QUEUED),
      ) as SimulationRunState;

      expect(afterRedelivery.batchTotal).toBe(5);
    });
  });

  describe("given commands", () => {
    it("emits events the aggregate can fold", () => {
      const events = simulationRun.commands.queueRun.handle(
        simulationRun.init(),
        BASE_QUEUED,
        simulationRun.events,
      );
      const state = fold(
        events as ReturnType<typeof simulationRun.events.queued>[],
      );
      expect(state.status).toBe("QUEUED");
      expect(state.scenarioId).toBe("scenario-1");
    });
  });
});
