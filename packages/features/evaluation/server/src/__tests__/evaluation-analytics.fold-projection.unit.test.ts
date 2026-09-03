import { describe, expect, it } from "vitest";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  EvaluationAnalyticsFoldProjection,
} from "../projections/evaluation-analytics-fold.projection";
import {
  type EvaluationAnalyticsData,
  EvaluationAnalyticsRowProjection,
} from "../projections/evaluation-analytics-row.projection";
import {
  createEvaluationCompletedEvent,
  createEvaluationReportedEvent,
  createEvaluationScheduledEvent,
  createEvaluationStartedEvent,
} from "./eventing/fixtures/evaluation-events.fixtures";
import { PreserveEvaluationAnalyticsAttributes } from "./eventing/fixtures/preserve-attributes.policy";

const TENANT = "proj-eval";
const attributePolicy = new PreserveEvaluationAnalyticsAttributes();
const rowProjection = EvaluationAnalyticsRowProjection.create();

function makeFold() {
  return EvaluationAnalyticsFoldProjection.create({
    store: { store: async () => {}, get: async () => null },
  });
}

function projectFromState(state: EvaluationAnalyticsData) {
  return rowProjection.project({
    state,
    tenantId: TENANT,
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    attributePolicy,
  });
}

const makeScheduled = () =>
  createEvaluationScheduledEvent({ metadata: { "metadata.team": "platform" } });

const makeStarted = () => createEvaluationStartedEvent({ occurredAt: 1_000_500 });

const makeCompleted = () => createEvaluationCompletedEvent({ occurredAt: 1_002_500 });

const makeReportedAtomic = () =>
  createEvaluationReportedEvent({
    evaluationId: "eval-2",
    occurredAt: 1_100_000,
  });

describe("evaluationAnalytics fold projection — slim row derivation", () => {
  describe("given a scheduled → started → completed sequence", () => {
    it("projects the final status, score, passed, label onto the slim row", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationScheduled(makeScheduled(), state);
      state = fold.handleEvaluationStarted(makeStarted(), state);
      state = fold.handleEvaluationCompleted(makeCompleted(), state);

      const row = projectFromState({
        ...state,
        // The base class manages LastEventOccurredAt during apply(); the
        // unit test exercises handlers directly so we stamp it here for
        // the projection.
        LastEventOccurredAt: 1_002_500,
      });

      expect(row.tenantId).toBe(TENANT);
      expect(row.evaluationId).toBe("eval-1");
      expect(row.evaluatorType).toBe("langevals/llm_answer_match");
      expect(row.evaluatorName).toBe("Judge");
      expect(row.status).toBe("processed");
      expect(row.score).toBe(0.85);
      expect(row.passed).toBe(true);
      expect(row.label).toBe("good");
      expect(row.traceId).toBe("trace-1");
      expect(row.isGuardrail).toBe(false);
      expect(row.durationMs).toBe(2_000); // completedAt - startedAt
    });

    it("drops the heavy fields (inputs, details, error, errorDetails)", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationCompleted(makeCompleted(), state);

      const row = projectFromState({
        ...state,
        LastEventOccurredAt: 1_002_500,
      });
      // The slim row shape simply has no field for those — proves
      // they're not surfaced.
      expect(Object.keys(row)).not.toContain("inputs");
      expect(Object.keys(row)).not.toContain("details");
      expect(Object.keys(row)).not.toContain("error");
      expect(Object.keys(row)).not.toContain("errorDetails");
    });

    it("hoists string-valued event metadata into the trimmed Attributes map", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationScheduled(makeScheduled(), state);

      const row = projectFromState({
        ...state,
        LastEventOccurredAt: 1_000_000,
      });
      // metadata.team is a metadata.* key → kept.
      expect(row.attributes["metadata.team"]).toBe("platform");
    });
  });

  describe("given a completed event with a non-processed status carrying a verdict", () => {
    it("writes passed and score as null when status is error", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationCompleted(
        createEvaluationCompletedEvent({
          status: "error",
          passed: false,
          score: 0.1,
        }),
        state,
      );

      const row = projectFromState({
        ...state,
        LastEventOccurredAt: 1_002_500,
      });
      expect(row.status).toBe("error");
      expect(row.passed).toBeNull();
      expect(row.score).toBeNull();
    });

    it("writes passed and score as null when status is skipped", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationCompleted(
        createEvaluationCompletedEvent({
          status: "skipped",
          passed: true,
          score: 1,
        }),
        state,
      );

      const row = projectFromState({
        ...state,
        LastEventOccurredAt: 1_002_500,
      });
      expect(row.status).toBe("skipped");
      expect(row.passed).toBeNull();
      expect(row.score).toBeNull();
    });
  });

  describe("given an atomic reported event with a non-processed status carrying a verdict", () => {
    it("writes passed and score as null", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationReported(
        createEvaluationReportedEvent({
          evaluationId: "eval-3",
          status: "error",
          passed: false,
          score: 0.2,
        }),
        state,
      );

      const row = projectFromState({
        ...state,
        LastEventOccurredAt: 1_100_000,
      });
      expect(row.status).toBe("error");
      expect(row.passed).toBeNull();
      expect(row.score).toBeNull();
    });
  });

  describe("given an atomic EvaluationReported event", () => {
    it("stamps identity + result in one shot and sets duration to 0", () => {
      const fold = makeFold();
      let state = fold.init();
      state = fold.handleEvaluationReported(makeReportedAtomic(), state);

      const row = projectFromState({
        ...state,
        LastEventOccurredAt: 1_100_000,
      });
      expect(row.evaluationId).toBe("eval-2");
      expect(row.evaluatorType).toBe("langevals/custom");
      expect(row.evaluatorName).toBe("Custom");
      expect(row.status).toBe("error");
      expect(row.passed).toBeNull();
      expect(row.score).toBeNull();
      expect(row.isGuardrail).toBe(true);
      // Reported sets startedAt = completedAt = event.occurredAt; duration = 0.
      expect(row.durationMs).toBe(0);
    });
  });
});
