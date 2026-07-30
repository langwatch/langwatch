import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { simulationRun } from "../aggregate";
import { initSimulationRunState, type SimulationRunState } from "../schema";
import { outranksStoredTerminal } from "../status";

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

const RUN_ID = "run-1";

const BASE_QUEUED = {
  scenarioRunId: RUN_ID,
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  occurredAt: 1,
};

const BASE_STARTED = {
  scenarioRunId: RUN_ID,
  scenarioId: "scenario-1",
  batchRunId: "batch-1",
  scenarioSetId: "set-1",
  occurredAt: 2,
};

describe("simulation_run aggregate", () => {
  describe("given the aggregate declaration", () => {
    it("derives the dotted type strings already in the event log", () => {
      expect([...simulationRun.eventTypes].sort()).toEqual(
        [
          "lw.simulation_run.queued",
          "lw.simulation_run.started",
          "lw.simulation_run.message_snapshot",
          "lw.simulation_run.text_message_start",
          "lw.simulation_run.text_message_end",
          "lw.simulation_run.finished",
          "lw.simulation_run.metrics_recorded",
          "lw.simulation_run.cancel_requested",
          "lw.simulation_run.deleted",
        ].sort(),
      );
    });

    it("extracts the aggregate id from any event's own payload", () => {
      expect(simulationRun.id(BASE_QUEUED)).toBe(RUN_ID);
      expect(simulationRun.id({ scenarioRunId: "run-2", occurredAt: 1 })).toBe(
        "run-2",
      );
    });

    it("holds nothing that grows with the run's work", () => {
      expect(Object.keys(simulationRun.init()).sort()).toEqual(
        [
          "archivedAt",
          "batchRunId",
          "batchTotal",
          "cancellationRequestedAt",
          "description",
          "durationMs",
          "error",
          "finishedAt",
          "metCriteria",
          "metadata",
          "name",
          "queuedAt",
          "reasoning",
          "roleCosts",
          "roleLatencies",
          "scenarioId",
          "scenarioRunId",
          "scenarioSetId",
          "startedAt",
          "status",
          "totalCost",
          "traceIds",
          "unmetCriteria",
          "verdict",
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
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
          status: "CANCELLED",
          occurredAt: 10,
        }),
      ]);

      const withLateSuccess = simulationRun.apply(
        cancelledFirst,
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
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
          scenarioRunId: RUN_ID,
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 10,
        }),
      ]);

      const withLateCancel = simulationRun.apply(
        succeededFirst,
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
          status: "CANCELLED",
          occurredAt: 20,
        }),
      ) as SimulationRunState;

      expect(withLateCancel.status).toBe("CANCELLED");
    });

    /** @scenario "Two terminal declarations of equal authority keep the first" */
    it("keeps the first success when a second one is folded", () => {
      const firstFinish = fold([
        simulationRun.events.queued(BASE_QUEUED),
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
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
          scenarioRunId: RUN_ID,
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
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
          status: "STALLED",
          occurredAt: 10,
        }),
      ]);

      const recovered = simulationRun.apply(
        stalled,
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
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
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
          status: "CANCELLED",
          occurredAt: 10,
        }),
      ]);

      const afterLateStart = simulationRun.apply(
        cancelled,
        simulationRun.events.started(BASE_STARTED),
      ) as SimulationRunState;

      expect(afterLateStart.status).toBe("CANCELLED");
      expect(afterLateStart.finishedAt).toBe(10);
    });

    it("ranks a cancel above an observed outcome and a stall below one", () => {
      expect(outranksStoredTerminal("SUCCESS", "CANCELLED")).toBe(true);
      expect(outranksStoredTerminal("CANCELLED", "SUCCESS")).toBe(false);
      expect(outranksStoredTerminal("STALLED", "FAILURE")).toBe(true);
      expect(outranksStoredTerminal("SUCCESS", "FAILURE")).toBe(false);
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
        simulationRun.events.finished({
          scenarioRunId: RUN_ID,
          status: "ERROR",
          occurredAt: 10,
        }),
      ]);

      const afterLateQueue = simulationRun.apply(
        failed,
        simulationRun.events.queued(BASE_QUEUED),
      ) as SimulationRunState;

      expect(afterLateQueue.status).toBe("ERROR");
    });

    /** @scenario "A run measured under a retired event type keeps its cost on replay" */
    it("no-ops on an event type it was not built to handle", () => {
      const measured = simulationRun.apply(
        initSimulationRunState(),
        simulationRun.events.metricsRecorded({
          scenarioRunId: RUN_ID,
          traceIds: ["trace-1"],
          totalCost: 1.5,
          roleCosts: { agent: [1.5] },
          roleLatencies: { agent: [200] },
        }),
      ) as SimulationRunState;

      const afterRetiredEvent = simulationRun.apply(measured, {
        type: "lw.simulation_run.metrics_computed",
        data: {
          scenarioRunId: RUN_ID,
          traceId: "t",
          totalCost: 0,
          roleCosts: {},
          roleLatencies: {},
        },
      });

      expect(afterRetiredEvent).toEqual(measured);
      expect(afterRetiredEvent.totalCost).toBe(1.5);
    });

    /**
     * The fold carries no delivery sequence, so every field has to be
     * idempotent and commutative on its own (ADR-098 §5). The set below is a
     * whole run: queued, started, both message modes, a measurement, a cancel
     * request, two competing terminal declarations, and a delete.
     */
    /** @scenario "A run's state is the same whatever order its events arrive in" */
    it("reaches the same state under every ordering and every re-delivery", () => {
      const report = checkOrderInvariance({
        init: simulationRun.init,
        apply: simulationRun.apply,
        events: [
          simulationRun.events.queued({ ...BASE_QUEUED, batchTotal: 4 }),
          simulationRun.events.started(BASE_STARTED),
          simulationRun.events.messageSnapshot({
            scenarioRunId: RUN_ID,
            messages: [{ id: "m1", role: "user", content: "hello" }],
            traceIds: ["trace-1"],
            status: "IN_PROGRESS",
            occurredAt: 50,
          }),
          simulationRun.events.textMessageStart({
            scenarioRunId: RUN_ID,
            messageId: "m2",
            role: "assistant",
            messageIndex: 1,
            occurredAt: 60,
          }),
          simulationRun.events.textMessageEnd({
            scenarioRunId: RUN_ID,
            messageId: "m2",
            role: "assistant",
            content: "hi",
            traceId: "trace-2",
            messageIndex: 1,
            occurredAt: 70,
          }),
          simulationRun.events.metricsRecorded({
            scenarioRunId: RUN_ID,
            traceIds: ["trace-1", "trace-2"],
            totalCost: 1.5,
            roleCosts: { agent: [1.5] },
            roleLatencies: { agent: [200] },
          }),
          simulationRun.events.cancelRequested({
            scenarioRunId: RUN_ID,
            occurredAt: 120,
          }),
          simulationRun.events.finished({
            scenarioRunId: RUN_ID,
            results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
            occurredAt: 130,
          }),
          simulationRun.events.finished({
            scenarioRunId: RUN_ID,
            status: "CANCELLED",
            occurredAt: 140,
          }),
          simulationRun.events.deleted({
            scenarioRunId: RUN_ID,
            occurredAt: 200,
          }),
        ],
      });

      expect(report.counterexample).toBeUndefined();
      expect(report.invariant).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // ADR-103 — a run's totals are a query, not a counter
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
      expect(state.scenarioRunId).toBe(RUN_ID);
    });
  });
});
