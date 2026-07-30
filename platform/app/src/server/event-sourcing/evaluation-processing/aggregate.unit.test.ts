import {
  checkOrderInvariance,
  checkTypeStringRatchet,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { evaluation } from "./aggregate";
import { EVALUATION_PROCESSING_TYPE_STRINGS } from "./typeStrings.snapshot";

describe("evaluation aggregate", () => {
  describe("given events are declared", () => {
    it("derives the dotted type strings already in the event log", () => {
      expect([...evaluation.eventTypes].sort()).toEqual([
        "lw.evaluation.reported",
        "lw.evaluation.started",
      ]);
    });

    it("creates a started event carrying that type string and the given payload", () => {
      const event = evaluation.events.started({
        evaluationId: "eval-1",
        evaluatorId: "monitor-1",
        evaluatorType: "langevals/answer_correctness",
        occurredAt: 1_000,
      });
      expect(event.type).toBe("lw.evaluation.started");
      expect(event.data.evaluationId).toBe("eval-1");
    });

    it("extracts the aggregate id from any event's payload", () => {
      expect(
        evaluation.id({
          evaluationId: "eval-7",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          occurredAt: 1_000,
        }),
      ).toBe("eval-7");
    });
  });

  describe("when a started event is applied to a fresh aggregate", () => {
    it("moves status to in_progress and records identity + startedAt", () => {
      const state = evaluation.apply(
        evaluation.init(),
        evaluation.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          evaluatorName: "Answer Correctness",
          traceId: "trace-1",
          occurredAt: 1_000,
        }),
      );

      expect(state.status).toBe("in_progress");
      expect(state.startedAt).toBe(1_000);
      expect(state.evaluatorType).toBe("langevals/answer_correctness");
      expect(state.traceId).toBe("trace-1");
    });
  });

  describe("when a reported event is applied", () => {
    it("sets the terminal status and completedAt", () => {
      const state = evaluation.apply(
        evaluation.init(),
        evaluation.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          score: 0.87,
          occurredAt: 2_000,
        }),
      );

      expect(state.status).toBe("processed");
      expect(state.score).toBe(0.87);
      expect(state.completedAt).toBe(2_000);
    });

    it("backfills startedAt when no started event preceded it (the atomic monitor path)", () => {
      const state = evaluation.apply(
        evaluation.init(),
        evaluation.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "skipped",
          occurredAt: 3_000,
        }),
      );

      expect(state.startedAt).toBe(3_000);
      expect(state.completedAt).toBe(3_000);
    });
  });

  describe("when a started event arrives after the matching reported event", () => {
    /**
     * A redelivery, or a race between the SDK's two report phases, can land
     * `started` after `reported`. Moving status back would leave the
     * evaluation counted as running forever — nothing re-delivers the
     * terminal fact to correct it.
     * @scenario "A finished evaluation is never re-counted as running"
     */
    it("does not move status back to in_progress, and does not lose the terminal result", () => {
      const reported = evaluation.apply(
        evaluation.init(),
        evaluation.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          score: 0.9,
          occurredAt: 2_000,
        }),
      );

      const afterLateStart = evaluation.apply(
        reported,
        evaluation.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          // Earlier than the report: a late arrival, not a new attempt.
          occurredAt: 1_000,
        }),
      );

      expect(afterLateStart.status).toBe("processed");
      expect(afterLateStart.score).toBe(0.9);
      expect(afterLateStart.completedAt).toBe(2_000);
      // `reported` alone backfilled startedAt to its own 2_000; the late
      // `started` still corrects it to the genuine 1_000.
      expect(afterLateStart.startedAt).toBe(1_000);
    });

    it("still widens identity fields the terminal event did not carry", () => {
      const reported = evaluation.apply(
        evaluation.init(),
        evaluation.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          occurredAt: 2_000,
        }),
      );

      const afterLateStart = evaluation.apply(
        reported,
        evaluation.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          evaluatorName: "Answer Correctness",
          traceId: "trace-1",
          occurredAt: 1_000,
        }),
      );

      expect(afterLateStart.evaluatorName).toBe("Answer Correctness");
      expect(afterLateStart.traceId).toBe("trace-1");
    });
  });

  describe("when the fold is checked for order-invariance", () => {
    /**
     * @scenario "The evaluation fold converges regardless of delivery order"
     */
    it("converges to the same state under every order and every re-delivery", () => {
      const events = [
        evaluation.events.started({
          evaluationId: "eval-2",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          evaluatorName: "Answer Correctness",
          traceId: "trace-2",
          occurredAt: 1_000,
          metadata: { thread: "t-1" },
        }),
        evaluation.events.reported({
          evaluationId: "eval-2",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          score: 0.75,
          passed: true,
          label: "good",
          occurredAt: 2_000,
        }),
      ];

      const report = checkOrderInvariance({
        init: evaluation.init,
        apply: evaluation.apply,
        events,
      });

      expect(report.invariant).toBe(true);
      expect(report.duplicatesChecked).toBe(events.length);
    });
  });

  describe("when the type-string ratchet runs", () => {
    /**
     * @scenario "The event type strings are ratcheted against the committed snapshot"
     */
    it("keeps every previously declared type string", () => {
      const violations = checkTypeStringRatchet({
        snapshot: EVALUATION_PROCESSING_TYPE_STRINGS,
        current: { evaluation: evaluation.eventTypes },
      });

      expect(violations).toEqual([]);
    });
  });
});
