import {
  checkOrderInvariance,
  checkTypeStringRatchet,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { evaluationAggregate } from "./aggregate";
import { EVALUATION_PROCESSING_TYPE_STRINGS } from "./typeStrings.snapshot";

describe("evaluation aggregate", () => {
  describe("given events are declared", () => {
    it("derives a type string per event, qualified by the aggregate", () => {
      expect([...evaluationAggregate.eventTypes].sort()).toEqual([
        "evaluation/reported",
        "evaluation/started",
      ]);
    });

    it("creates a started event carrying the qualified type string and the given payload", () => {
      const event = evaluationAggregate.events.started({
        evaluationId: "eval-1",
        evaluatorId: "monitor-1",
        evaluatorType: "langevals/answer_correctness",
        occurredAt: 1_000,
      });
      expect(event.type).toBe("evaluation/started");
      expect(event.data.evaluationId).toBe("eval-1");
    });
  });

  describe("when a started event is applied to a fresh aggregate", () => {
    it("moves status to in_progress and records identity + startedAt", () => {
      const state = evaluationAggregate.apply(
        evaluationAggregate.init(),
        evaluationAggregate.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          evaluatorName: "Answer Correctness",
          traceId: "trace-1",
          occurredAt: 1_000,
        }),
      );

      expect(state.status).toBe("in_progress");
      expect(state.startedAtMs).toBe(1_000);
      expect(state.evaluatorType).toBe("langevals/answer_correctness");
      expect(state.traceId).toBe("trace-1");
    });
  });

  describe("when a reported event is applied", () => {
    it("sets the terminal status and completedAt", () => {
      const state = evaluationAggregate.apply(
        evaluationAggregate.init(),
        evaluationAggregate.events.reported({
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
      expect(state.completedAtMs).toBe(2_000);
    });

    it("backfills startedAtMs when no started event preceded it (the atomic monitor path)", () => {
      const state = evaluationAggregate.apply(
        evaluationAggregate.init(),
        evaluationAggregate.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "skipped",
          occurredAt: 3_000,
        }),
      );

      expect(state.startedAtMs).toBe(3_000);
      expect(state.completedAtMs).toBe(3_000);
    });
  });

  describe("when a started event arrives after the matching reported event", () => {
    /**
     * Delivery order is best effort (ADR-098 decision 4): a redelivery, or a
     * genuine race between an SDK's two report phases, can land `started`
     * after `reported`. Without a guard, the old pipeline's unconditional
     * `status: "in_progress"` assignment would flip a finished evaluation
     * back to running — and nothing ever re-delivers the terminal fact to
     * correct it, so it would stay miscounted as running forever.
     * @scenario "A finished evaluation is never re-counted as running"
     */
    it("does not move status back to in_progress, and does not lose the terminal result", () => {
      const reported = evaluationAggregate.apply(
        evaluationAggregate.init(),
        evaluationAggregate.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          score: 0.9,
          occurredAt: 2_000,
        }),
      );

      const afterLateStart = evaluationAggregate.apply(
        reported,
        evaluationAggregate.events.started({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          // Timestamped earlier than the report — this is the late arrival,
          // not a new attempt.
          occurredAt: 1_000,
        }),
      );

      expect(afterLateStart.status).toBe("processed");
      expect(afterLateStart.score).toBe(0.9);
      expect(afterLateStart.completedAtMs).toBe(2_000);
      // startedAtMs is still refined to the true (earlier) start time even
      // though status cannot move — see `earliestKnown` in aggregate.ts.
      // `reported` alone had backfilled it to 2_000 (its own occurredAt);
      // the late `started` event corrects it to the genuine 1_000.
      expect(afterLateStart.startedAtMs).toBe(1_000);
    });

    it("still widens identity fields the terminal event did not carry", () => {
      const reported = evaluationAggregate.apply(
        evaluationAggregate.init(),
        evaluationAggregate.events.reported({
          evaluationId: "eval-1",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          occurredAt: 2_000,
        }),
      );

      const afterLateStart = evaluationAggregate.apply(
        reported,
        evaluationAggregate.events.started({
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
    it("converges to the same state regardless of delivery order", () => {
      const events = [
        evaluationAggregate.events.started({
          evaluationId: "eval-2",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          evaluatorName: "Answer Correctness",
          traceId: "trace-2",
          occurredAt: 1_000,
        }),
        evaluationAggregate.events.reported({
          evaluationId: "eval-2",
          evaluatorId: "monitor-1",
          evaluatorType: "langevals/answer_correctness",
          status: "processed",
          score: 0.75,
          passed: true,
          occurredAt: 2_000,
        }),
      ];

      const report = checkOrderInvariance({
        init: evaluationAggregate.init,
        apply: evaluationAggregate.apply,
        events,
      });

      expect(report.invariant).toBe(true);
    });
  });

  describe("when the type-string ratchet runs", () => {
    /**
     * @scenario "The event type strings are ratcheted against the committed snapshot"
     */
    it("keeps every previously declared type string", () => {
      const violations = checkTypeStringRatchet({
        snapshot: EVALUATION_PROCESSING_TYPE_STRINGS,
        current: { evaluation: evaluationAggregate.eventTypes },
      });

      expect(violations).toEqual([]);
    });
  });
});
