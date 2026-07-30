import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
    applyEvaluationReported,
    applyEvaluationStarted,
    initEvaluationState,
} from "./evaluationAnalytics.projection";
import type { EvaluationReportedData, EvaluationStartedData } from "./schema";

function started(overrides: Partial<EvaluationStartedData> = {}): EvaluationStartedData {
  return {
    evaluationId: "eval-1",
    evaluatorId: "monitor-1",
    evaluatorType: "langevals/answer_correctness",
    occurredAt: 1_000,
    ...overrides,
  };
}

function reported(overrides: Partial<EvaluationReportedData> = {}): EvaluationReportedData {
  return {
    evaluationId: "eval-1",
    evaluatorId: "monitor-1",
    evaluatorType: "langevals/answer_correctness",
    status: "processed",
    occurredAt: 2_000,
    ...overrides,
  };
}

describe("evaluationAnalytics projection", () => {
  describe("when a started event is applied to a fresh state", () => {
    it("moves status to in_progress and records identity + the occurred-at anchor", () => {
      const state = applyEvaluationStarted(
        initEvaluationState(),
        started({ evaluatorName: "Answer Correctness", traceId: "trace-1" }),
      );

      expect(state.status).toBe("in_progress");
      expect(state.occurredAt).toBe(1_000);
      expect(state.evaluatorType).toBe("langevals/answer_correctness");
      expect(state.traceId).toBe("trace-1");
    });
  });

  describe("when a reported event is applied", () => {
    it("sets the terminal status and completedAt", () => {
      const state = applyEvaluationReported(
        initEvaluationState(),
        reported({ score: 0.87, occurredAt: 2_000 }),
      );

      expect(state.status).toBe("processed");
      expect(state.score).toBe(0.87);
      expect(state.completedAt).toBe(2_000);
    });

    it("backfills the anchor when no started event preceded it (the atomic monitor path)", () => {
      const state = applyEvaluationReported(
        initEvaluationState(),
        reported({ status: "skipped", occurredAt: 3_000 }),
      );

      expect(state.occurredAt).toBe(3_000);
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
      const afterReport = applyEvaluationReported(
        initEvaluationState(),
        reported({ score: 0.9, occurredAt: 2_000 }),
      );

      const afterLateStart = applyEvaluationStarted(
        afterReport,
        // Earlier than the report: a late arrival, not a new attempt.
        started({ occurredAt: 1_000 }),
      );

      expect(afterLateStart.status).toBe("processed");
      expect(afterLateStart.score).toBe(0.9);
      expect(afterLateStart.completedAt).toBe(2_000);
      // `reported` alone anchored at its own 2_000; the late `started` still
      // corrects the anchor to the genuine 1_000.
      expect(afterLateStart.occurredAt).toBe(1_000);
    });

    it("still widens identity fields the terminal event did not carry", () => {
      const afterReport = applyEvaluationReported(initEvaluationState(), reported());

      const afterLateStart = applyEvaluationStarted(
        afterReport,
        started({ evaluatorName: "Answer Correctness", traceId: "trace-1" }),
      );

      expect(afterLateStart.evaluatorName).toBe("Answer Correctness");
      expect(afterLateStart.traceId).toBe("trace-1");
    });

    /**
     * Only `started` carries the guardrail flag. Reading it as a plain
     * assignment lost it whenever `reported` landed first, and a guardrail
     * recorded as an ordinary evaluation is counted in the wrong population.
     * @scenario "A guardrail evaluation stays a guardrail whichever event lands first"
     */
    it("keeps the guardrail flag the late started event carried", () => {
      const startedEvent = started({ isGuardrail: true });
      const reportedEvent = reported();

      // Applied explicitly rather than through a generic reducer, since the
      // two events use different handlers.
      const startedThenReported = applyEvaluationReported(
        applyEvaluationStarted(initEvaluationState(), startedEvent),
        reportedEvent,
      );
      const reportedThenStarted = applyEvaluationStarted(
        applyEvaluationReported(initEvaluationState(), reportedEvent),
        startedEvent,
      );

      expect(startedThenReported.isGuardrail).toBe(true);
      expect(reportedThenStarted.isGuardrail).toBe(true);
    });

    /**
     * @scenario "A metadata key carried by both events resolves the same way in either order"
     */
    it("resolves a metadata key both events carry in favour of the report, either way round", () => {
      const startedEvent = started({ metadata: { stage: "start", thread: "t-1" } });
      const reportedEvent = reported({ metadata: { stage: "final" } });

      const startedThenReported = applyEvaluationReported(
        applyEvaluationStarted(initEvaluationState(), startedEvent),
        reportedEvent,
      );
      const reportedThenStarted = applyEvaluationStarted(
        applyEvaluationReported(initEvaluationState(), reportedEvent),
        startedEvent,
      );

      expect(startedThenReported.attributes).toEqual({
        stage: "final",
        thread: "t-1",
      });
      expect(reportedThenStarted.attributes).toEqual(startedThenReported.attributes);
    });
  });

  describe("when the fold is checked for order-invariance", () => {
    /**
     * @scenario "The evaluation fold converges regardless of delivery order"
     */
    it("converges to the same state under every order and every re-delivery", () => {
      const events = [
        {
          type: "started",
          data: started({
            evaluatorName: "Answer Correctness",
            traceId: "trace-2",
            isGuardrail: true,
            metadata: { thread: "t-1", stage: "start" },
          }),
        },
        {
          type: "reported",
          data: reported({
            score: 0.75,
            passed: true,
            label: "good",
            metadata: { stage: "final", cost: 3 },
          }),
        },
      ] as const;

      const report = checkOrderInvariance({
        init: initEvaluationState,
        apply: (state, event) =>
          event.type === "started"
            ? applyEvaluationStarted(state, event.data)
            : applyEvaluationReported(state, event.data),
        events,
      });

      expect(report.counterexample).toBeUndefined();
      expect(report.invariant).toBe(true);
      expect(report.duplicatesChecked).toBe(events.length);
    });
  });
});
