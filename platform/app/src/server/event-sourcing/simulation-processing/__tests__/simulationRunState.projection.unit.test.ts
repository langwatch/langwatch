import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { initSimulationRunState, runStartedDataSchema } from "../schema";
import type {
  CancelRequestedData,
  MessageSnapshotData,
  MetricsRecordedData,
  RunDeletedData,
  RunFinishedData,
  RunQueuedData,
  RunStartedData,
  SimulationRunState,
  TextMessageEndData,
  TextMessageStartData,
} from "../schema";
import {
  applyCancelRequested,
  applyDeleted,
  applyFinished,
  applyMessageSnapshot,
  applyMetricsRecorded,
  applyQueued,
  applyStarted,
  applyTextMessageEnd,
  applyTextMessageStart,
  outranksStoredTerminal,
} from "../simulationRunState.projection";

/**
 * @see specs/event-sourcing/simulation-run-aggregate.feature
 */

type FoldEvent =
  | { readonly type: "queued"; readonly data: RunQueuedData }
  | { readonly type: "started"; readonly data: RunStartedData }
  | { readonly type: "messageSnapshot"; readonly data: MessageSnapshotData }
  | { readonly type: "textMessageStart"; readonly data: TextMessageStartData }
  | { readonly type: "textMessageEnd"; readonly data: TextMessageEndData }
  | { readonly type: "finished"; readonly data: RunFinishedData }
  | { readonly type: "metricsRecorded"; readonly data: MetricsRecordedData }
  | { readonly type: "cancelRequested"; readonly data: CancelRequestedData }
  | { readonly type: "deleted"; readonly data: RunDeletedData };

/** Keyed by event, never switched over event (ADR-105 decision 5) — the same
 * shape `.withFold(name, { on: {...} })` mounts in `index.ts`. */
const events = {
  queued: (data: RunQueuedData): FoldEvent => ({ type: "queued", data }),
  started: (data: RunStartedData): FoldEvent => ({ type: "started", data }),
  messageSnapshot: (data: MessageSnapshotData): FoldEvent => ({
    type: "messageSnapshot",
    data,
  }),
  textMessageStart: (data: TextMessageStartData): FoldEvent => ({
    type: "textMessageStart",
    data,
  }),
  textMessageEnd: (data: TextMessageEndData): FoldEvent => ({
    type: "textMessageEnd",
    data,
  }),
  finished: (data: RunFinishedData): FoldEvent => ({ type: "finished", data }),
  metricsRecorded: (data: MetricsRecordedData): FoldEvent => ({
    type: "metricsRecorded",
    data,
  }),
  cancelRequested: (data: CancelRequestedData): FoldEvent => ({
    type: "cancelRequested",
    data,
  }),
  deleted: (data: RunDeletedData): FoldEvent => ({ type: "deleted", data }),
};

function apply(state: SimulationRunState, event: FoldEvent): SimulationRunState {
  switch (event.type) {
    case "queued":
      return applyQueued(state, event.data);
    case "started":
      return applyStarted(state, event.data);
    case "messageSnapshot":
      return applyMessageSnapshot(state, event.data);
    case "textMessageStart":
      return applyTextMessageStart(state, event.data);
    case "textMessageEnd":
      return applyTextMessageEnd(state, event.data);
    case "finished":
      return applyFinished(state, event.data);
    case "metricsRecorded":
      return applyMetricsRecorded(state, event.data);
    case "cancelRequested":
      return applyCancelRequested(state, event.data);
    case "deleted":
      return applyDeleted(state, event.data);
  }
}

function fold(list: readonly FoldEvent[]): SimulationRunState {
  return list.reduce(apply, initSimulationRunState());
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

describe("the simulationRunState fold's handlers", () => {
  describe("given the fold's state shape", () => {
    it("holds nothing that grows with the run's work", () => {
      expect(Object.keys(initSimulationRunState()).sort()).toEqual(
        [
          "archivedAt",
          "batchRunId",
          "batchTotal",
          "cancellationRequestedAt",
          "createdAt",
          "description",
          "durationMs",
          "error",
          "finishedAt",
          "lastEventOccurredAt",
          "metCriteria",
          "metadata",
          "metricsAsOf",
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

  describe("given the run's observation window", () => {
    it("widens to the earliest and latest instant any of its events claims", () => {
      const state = fold([
        events.started(BASE_STARTED),
        events.queued(BASE_QUEUED),
        events.deleted({ scenarioRunId: RUN_ID, occurredAt: 90 }),
      ]);

      expect(state.createdAt).toBe(1);
      expect(state.lastEventOccurredAt).toBe(90);
    });

    it("never derives the row's partition anchor from an event", () => {
      const state = fold([
        events.queued(BASE_QUEUED),
        events.started(BASE_STARTED),
        events.textMessageEnd({
          scenarioRunId: RUN_ID,
          messageId: "m1",
          role: "assistant",
          content: "hi",
          messageIndex: 0,
          occurredAt: 70,
        }),
      ]);

      expect(state.startedAt).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Defect 1 — a cancelled run must never be resurrected as SUCCESS
  // ---------------------------------------------------------------------
  describe("given terminal status authority", () => {
    /** @scenario A cancel outranks a success that lands after it */
    it("keeps a run cancelled when a success arrives afterwards", () => {
      const cancelledFirst = fold([
        events.queued(BASE_QUEUED),
        events.finished({ scenarioRunId: RUN_ID, status: "CANCELLED", occurredAt: 10 }),
      ]);

      const withLateSuccess = apply(
        cancelledFirst,
        events.finished({
          scenarioRunId: RUN_ID,
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 20,
        }),
      );

      expect(withLateSuccess.status).toBe("CANCELLED");
      expect(withLateSuccess.finishedAt).toBe(10);
    });

    /** @scenario A cancel delivered after the success it overrode still wins */
    it("shows the run as cancelled when the cancel arrives after the success", () => {
      const succeededFirst = fold([
        events.queued(BASE_QUEUED),
        events.finished({
          scenarioRunId: RUN_ID,
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 10,
        }),
      ]);

      const withLateCancel = apply(
        succeededFirst,
        events.finished({ scenarioRunId: RUN_ID, status: "CANCELLED", occurredAt: 20 }),
      );

      expect(withLateCancel.status).toBe("CANCELLED");
    });

    /** @scenario Two terminal declarations of equal authority keep the first */
    it("keeps the earlier success when a second one is folded", () => {
      const firstFinish = fold([
        events.queued(BASE_QUEUED),
        events.finished({
          scenarioRunId: RUN_ID,
          results: { verdict: "success", reasoning: "first", metCriteria: [], unmetCriteria: [] },
          occurredAt: 10,
        }),
      ]);

      const afterSecond = apply(
        firstFinish,
        events.finished({
          scenarioRunId: RUN_ID,
          results: { verdict: "success", reasoning: "second", metCriteria: [], unmetCriteria: [] },
          occurredAt: 20,
        }),
      );

      expect(afterSecond.reasoning).toBe("first");
      expect(afterSecond.finishedAt).toBe(10);
    });

    /**
     * An `ERROR` and a `verdict: "failure"` carry the same authority, so
     * nothing but a total order decides between them — and the run's verdict,
     * reasoning, duration and finish instant move together with whichever
     * wins.
     */
    it("settles two equal-authority terminals the same way in either arrival order", () => {
      const errored = events.finished({
        scenarioRunId: RUN_ID,
        status: "ERROR",
        durationMs: 100,
        occurredAt: 30,
      });
      const failed = events.finished({
        scenarioRunId: RUN_ID,
        results: {
          verdict: "failure",
          reasoning: "criteria unmet",
          metCriteria: [],
          unmetCriteria: ["a"],
        },
        durationMs: 200,
        occurredAt: 30,
      });

      const errorFirst = fold([errored, failed]);
      const failureFirst = fold([failed, errored]);

      expect(errorFirst).toEqual(failureFirst);
      expect(errorFirst.status).toBe("ERROR");
      expect(errorFirst.verdict).toBeNull();
      expect(errorFirst.durationMs).toBe(100);
    });

    it("prefers the earlier of two equal-authority terminals whatever their statuses", () => {
      const late = events.finished({ scenarioRunId: RUN_ID, status: "ERROR", occurredAt: 40 });
      const early = events.finished({
        scenarioRunId: RUN_ID,
        results: { verdict: "failure", metCriteria: [], unmetCriteria: [] },
        occurredAt: 30,
      });

      expect(fold([late, early])).toEqual(fold([early, late]));
      expect(fold([late, early]).status).toBe("FAILURE");
      expect(fold([late, early]).finishedAt).toBe(30);
    });

    /** @scenario A genuine outcome supersedes a provisional stall */
    it("takes a stalled run back to successful when a real outcome lands", () => {
      const stalled = fold([
        events.queued(BASE_QUEUED),
        events.finished({ scenarioRunId: RUN_ID, status: "STALLED", occurredAt: 10 }),
      ]);

      const recovered = apply(
        stalled,
        events.finished({
          scenarioRunId: RUN_ID,
          results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
          occurredAt: 20,
        }),
      );

      expect(recovered.status).toBe("SUCCESS");
    });

    /** @scenario A late start does not resurrect a cancelled run */
    it("leaves a cancelled run cancelled when started is delivered late", () => {
      const cancelled = fold([
        events.queued(BASE_QUEUED),
        events.finished({ scenarioRunId: RUN_ID, status: "CANCELLED", occurredAt: 10 }),
      ]);

      const afterLateStart = apply(cancelled, events.started(BASE_STARTED));

      expect(afterLateStart.status).toBe("CANCELLED");
      expect(afterLateStart.finishedAt).toBe(10);
    });

    it("ranks a cancel above an observed outcome and a stall below one", () => {
      const at = 10;
      expect(outranksStoredTerminal({ status: "SUCCESS", at }, { status: "CANCELLED", at })).toBe(
        true,
      );
      expect(outranksStoredTerminal({ status: "CANCELLED", at }, { status: "SUCCESS", at })).toBe(
        false,
      );
      expect(outranksStoredTerminal({ status: "STALLED", at }, { status: "FAILURE", at })).toBe(
        true,
      );
    });

    it("is a total order over equal authority, so exactly one of a pair wins", () => {
      const a = { status: "ERROR", at: 30 };
      const b = { status: "FAILURE", at: 30 };
      expect(outranksStoredTerminal(a, b)).toBe(!outranksStoredTerminal(b, a));

      const earlier = { status: "SUCCESS", at: 10 };
      const later = { status: "SUCCESS", at: 20 };
      expect(outranksStoredTerminal(later, earlier)).toBe(true);
      expect(outranksStoredTerminal(earlier, later)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Metrics: one measurement replaces another, on its own stamp
  // ---------------------------------------------------------------------
  describe("given two measurements of one run", () => {
    const early = events.metricsRecorded({
      scenarioRunId: RUN_ID,
      traceIds: ["trace-1"],
      totalCost: 0,
      roleCosts: {},
      roleLatencies: {},
      occurredAt: 100,
    });
    const late = events.metricsRecorded({
      scenarioRunId: RUN_ID,
      traceIds: ["trace-1"],
      totalCost: 1.5,
      roleCosts: { agent: [1.5] },
      roleLatencies: { agent: [200] },
      occurredAt: 200,
    });

    it("keeps the later measurement whichever arrives first", () => {
      expect(fold([early, late])).toEqual(fold([late, early]));
      expect(fold([late, early]).totalCost).toBe(1.5);
      expect(fold([late, early]).roleCosts).toEqual({ agent: [1.5] });
    });

    it("does not let a pre-enrichment zero overwrite the enriched figure", () => {
      expect(fold([late, early]).totalCost).not.toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Order-invariance
  // ---------------------------------------------------------------------
  describe("given order-invariant handlers", () => {
    /** @scenario A late queue event does not put a finished run back in the queue */
    it("stays failed when a queued event is delivered after finished", () => {
      const failed = fold([
        events.queued(BASE_QUEUED),
        events.finished({ scenarioRunId: RUN_ID, status: "ERROR", occurredAt: 10 }),
      ]);

      const afterLateQueue = apply(failed, events.queued(BASE_QUEUED));

      expect(afterLateQueue.status).toBe("ERROR");
    });

    it("ignores a status string the run's lifecycle does not define", () => {
      const state = fold([
        events.queued(BASE_QUEUED),
        events.messageSnapshot({
          scenarioRunId: RUN_ID,
          messages: [],
          traceIds: [],
          status: "definitely-not-a-status",
          occurredAt: 50,
        }),
      ]);

      expect(state.status).toBe("QUEUED");
    });

    it("reads a lowercase status the same way as its canonical form", () => {
      const state = fold([
        events.queued(BASE_QUEUED),
        events.messageSnapshot({
          scenarioRunId: RUN_ID,
          messages: [],
          traceIds: [],
          status: "in_progress",
          occurredAt: 50,
        }),
      ]);

      expect(state.status).toBe("IN_PROGRESS");
    });

    /**
     * The fold carries no delivery sequence, so every field has to be
     * idempotent and commutative on its own (ADR-098 §5). The set below is a
     * whole run, including the cases that resolve by arrival order unless
     * something breaks the tie: two measurements, and two terminal
     * declarations of equal authority.
     */
    /** @scenario A run's state is the same whatever order its events arrive in */
    it("reaches the same state under every ordering and every re-delivery", () => {
      const report = checkOrderInvariance({
        init: initSimulationRunState,
        apply,
        events: [
          events.queued({ ...BASE_QUEUED, batchTotal: 4 }),
          events.started(BASE_STARTED),
          events.messageSnapshot({
            scenarioRunId: RUN_ID,
            messages: [{ id: "m1", role: "user", content: "hello" }],
            traceIds: ["trace-1"],
            status: "IN_PROGRESS",
            occurredAt: 50,
          }),
          events.textMessageStart({
            scenarioRunId: RUN_ID,
            messageId: "m2",
            role: "assistant",
            messageIndex: 1,
            occurredAt: 60,
          }),
          events.textMessageEnd({
            scenarioRunId: RUN_ID,
            messageId: "m2",
            role: "assistant",
            content: "hi",
            traceId: "trace-2",
            messageIndex: 1,
            occurredAt: 70,
          }),
          events.metricsRecorded({
            scenarioRunId: RUN_ID,
            traceIds: ["trace-1"],
            totalCost: 0,
            roleCosts: {},
            roleLatencies: {},
            occurredAt: 100,
          }),
          events.metricsRecorded({
            scenarioRunId: RUN_ID,
            traceIds: ["trace-1", "trace-2"],
            totalCost: 1.5,
            roleCosts: { agent: [1.5] },
            roleLatencies: { agent: [200] },
            occurredAt: 110,
          }),
          events.cancelRequested({ scenarioRunId: RUN_ID, occurredAt: 120 }),
          events.finished({
            scenarioRunId: RUN_ID,
            status: "ERROR",
            durationMs: 100,
            occurredAt: 130,
          }),
          events.finished({
            scenarioRunId: RUN_ID,
            results: {
              verdict: "failure",
              reasoning: "criteria unmet",
              metCriteria: [],
              unmetCriteria: ["a"],
            },
            durationMs: 200,
            occurredAt: 130,
          }),
          events.finished({ scenarioRunId: RUN_ID, status: "CANCELLED", occurredAt: 140 }),
          events.deleted({ scenarioRunId: RUN_ID, occurredAt: 200 }),
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
    /** @scenario Every run declares the batch total it was dispatched against */
    it("carries the batch total from the queued event", () => {
      const state = fold([events.queued({ ...BASE_QUEUED, batchTotal: 5 })]);
      expect(state.batchTotal).toBe(5);
    });

    /** @scenario A batch total established once is not erased by a later empty value */
    it("keeps a known batch total when a redelivered queued omits it", () => {
      const withTotal = fold([events.queued({ ...BASE_QUEUED, batchTotal: 5 })]);
      const afterRedelivery = apply(withTotal, events.queued(BASE_QUEUED));
      expect(afterRedelivery.batchTotal).toBe(5);
    });
  });

  describe("given the run's descriptor", () => {
    it("takes name, description and metadata from the queued event alone", () => {
      const state = fold([
        events.queued({
          ...BASE_QUEUED,
          name: "the run",
          description: "what it does",
          metadata: { k: "v" },
        }),
        events.started(BASE_STARTED),
      ]);

      expect(state.name).toBe("the run");
      expect(state.description).toBe("what it does");
      expect(state.metadata).toBe(JSON.stringify({ k: "v" }));
    });

    it("has no second carrier a started event could disagree with", () => {
      expect(Object.keys(runStartedDataSchema.shape)).toEqual([
        "scenarioRunId",
        "scenarioId",
        "batchRunId",
        "scenarioSetId",
        "occurredAt",
      ]);
    });
  });
});
