import { describe, expect, it } from "vitest";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  EvaluationAnalyticsFoldProjection,
  type EvaluationAnalyticsData,
  projectEvaluationAnalyticsStateToRow,
} from "../evaluationAnalytics.foldProjection";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "../../schemas/events";

const TENANT = "proj-eval";

function makeFold() {
  return new EvaluationAnalyticsFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

function projectFromState(state: EvaluationAnalyticsData) {
  return projectEvaluationAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

function makeScheduled(): EvaluationScheduledEvent {
  return {
    type: "lw.evaluation.scheduled",
    id: "evt-1",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: 1_000_000,
    data: {
      evaluationId: "eval-1",
      evaluatorId: "monitor-x",
      evaluatorType: "langevals/llm_answer_match",
      evaluatorName: "Judge",
      traceId: "trace-1",
      isGuardrail: false,
    },
    metadata: { "metadata.team": "platform" },
  } as unknown as EvaluationScheduledEvent;
}

function makeStarted(): EvaluationStartedEvent {
  return {
    type: "lw.evaluation.started",
    id: "evt-2",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: 1_000_500,
    data: {
      evaluationId: "eval-1",
      evaluatorId: "monitor-x",
      evaluatorType: "langevals/llm_answer_match",
    },
  } as unknown as EvaluationStartedEvent;
}

function makeCompleted(): EvaluationCompletedEvent {
  return {
    type: "lw.evaluation.completed",
    id: "evt-3",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: 1_002_500,
    data: {
      evaluationId: "eval-1",
      status: "processed",
      score: 0.85,
      passed: true,
      label: "good",
      details: "(redacted detail blob that the slim should drop)",
      inputs: { conversation: "(big blob)" },
      costId: "cost-1",
    },
  } as unknown as EvaluationCompletedEvent;
}

function makeReportedAtomic(): EvaluationReportedEvent {
  return {
    type: "lw.evaluation.reported",
    id: "evt-r",
    tenantId: TENANT,
    aggregateId: "eval-2",
    occurredAt: 1_100_000,
    data: {
      evaluationId: "eval-2",
      evaluatorId: "monitor-y",
      evaluatorType: "langevals/custom",
      evaluatorName: "Custom",
      traceId: "trace-9",
      isGuardrail: true,
      status: "error",
      score: null,
      passed: null,
      label: null,
      error: "boom",
      errorDetails: "(stack trace)",
    },
  } as unknown as EvaluationReportedEvent;
}

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
