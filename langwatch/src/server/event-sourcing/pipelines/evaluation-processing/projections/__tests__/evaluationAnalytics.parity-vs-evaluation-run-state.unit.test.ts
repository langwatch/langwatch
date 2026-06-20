import { describe, expect, it } from "vitest";
import { EvaluationAnalyticsFoldProjection } from "../evaluationAnalytics.foldProjection";
import { EvaluationRunFoldProjection } from "../evaluationRun.foldProjection";
import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "../../schemas/events";

/**
 * ADR-034 Phase 6 parity contract.
 *
 * The slim fold reuses the same per-event logic as `EvaluationRunFoldProjection`
 * for the shared fields. This test drives the SAME event stream through
 * both projections and asserts the shared fields agree to the cent.
 */

const TENANT = "proj-parity";

function makeScheduled(): EvaluationScheduledEvent {
  return {
    type: "lw.evaluation.scheduled",
    id: "evt-1",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: 5_000,
    data: {
      evaluationId: "eval-1",
      evaluatorId: "monitor-x",
      evaluatorType: "langevals/judge",
      evaluatorName: "Judge",
      traceId: "trace-1",
      isGuardrail: false,
    },
  } as unknown as EvaluationScheduledEvent;
}

function makeStarted(): EvaluationStartedEvent {
  return {
    type: "lw.evaluation.started",
    id: "evt-2",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: 5_500,
    data: {
      evaluationId: "eval-1",
      evaluatorId: "monitor-x",
      evaluatorType: "langevals/judge",
    },
  } as unknown as EvaluationStartedEvent;
}

function makeCompleted(): EvaluationCompletedEvent {
  return {
    type: "lw.evaluation.completed",
    id: "evt-3",
    tenantId: TENANT,
    aggregateId: "eval-1",
    occurredAt: 7_500,
    data: {
      evaluationId: "eval-1",
      status: "processed",
      score: 0.42,
      passed: false,
      label: "needs_review",
      details: "(redacted)",
      inputs: { q: "x" },
      costId: "cost-9",
    },
  } as unknown as EvaluationCompletedEvent;
}

function makeReported(): EvaluationReportedEvent {
  return {
    type: "lw.evaluation.reported",
    id: "evt-r",
    tenantId: TENANT,
    aggregateId: "eval-2",
    occurredAt: 9_000,
    data: {
      evaluationId: "eval-2",
      evaluatorId: "monitor-y",
      evaluatorType: "langevals/custom",
      evaluatorName: "Custom",
      traceId: "trace-2",
      isGuardrail: true,
      status: "processed",
      score: 1,
      passed: true,
      label: "great",
      costId: "cost-r",
    },
  } as unknown as EvaluationReportedEvent;
}

describe("evaluationAnalytics fold — parity vs evaluationRun fold", () => {
  describe("given the scheduled → started → completed event stream", () => {
    it("agrees on every shared field (evaluatorType / status / score / passed / label / traceId / isGuardrail / costId)", () => {
      const slim = new EvaluationAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      const runFold = new EvaluationRunFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });

      let slimState = slim.init();
      let runState = runFold.init();
      const sched = makeScheduled();
      const started = makeStarted();
      const completed = makeCompleted();

      slimState = slim.handleEvaluationScheduled(sched, slimState);
      runState = runFold.handleEvaluationScheduled(sched, runState);
      slimState = slim.handleEvaluationStarted(started, slimState);
      runState = runFold.handleEvaluationStarted(started, runState);
      slimState = slim.handleEvaluationCompleted(completed, slimState);
      runState = runFold.handleEvaluationCompleted(completed, runState);

      // Shared fields: every key the slim state carries that's also on
      // the run state should agree by value.
      expect(slimState.evaluationId).toBe(runState.evaluationId);
      expect(slimState.evaluatorId).toBe(runState.evaluatorId);
      expect(slimState.evaluatorType).toBe(runState.evaluatorType);
      expect(slimState.evaluatorName).toBe(runState.evaluatorName);
      expect(slimState.status).toBe(runState.status);
      expect(slimState.score).toBe(runState.score);
      expect(slimState.passed).toBe(runState.passed);
      expect(slimState.label).toBe(runState.label);
      expect(slimState.traceId).toBe(runState.traceId);
      expect(slimState.isGuardrail).toBe(runState.isGuardrail);
      expect(slimState.costId).toBe(runState.costId);
      expect(slimState.scheduledAt).toBe(runState.scheduledAt);
      expect(slimState.startedAt).toBe(runState.startedAt);
      expect(slimState.completedAt).toBe(runState.completedAt);
    });
  });

  describe("given an atomic reported event", () => {
    it("agrees on every shared field", () => {
      const slim = new EvaluationAnalyticsFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });
      const runFold = new EvaluationRunFoldProjection({
        store: { store: async () => {}, get: async () => null },
      });

      const reported = makeReported();
      const slimState = slim.handleEvaluationReported(reported, slim.init());
      const runState = runFold.handleEvaluationReported(reported, runFold.init());

      expect(slimState.evaluationId).toBe(runState.evaluationId);
      expect(slimState.evaluatorId).toBe(runState.evaluatorId);
      expect(slimState.evaluatorType).toBe(runState.evaluatorType);
      expect(slimState.evaluatorName).toBe(runState.evaluatorName);
      expect(slimState.status).toBe(runState.status);
      expect(slimState.score).toBe(runState.score);
      expect(slimState.passed).toBe(runState.passed);
      expect(slimState.label).toBe(runState.label);
      expect(slimState.traceId).toBe(runState.traceId);
      expect(slimState.isGuardrail).toBe(runState.isGuardrail);
      expect(slimState.costId).toBe(runState.costId);
      expect(slimState.startedAt).toBe(runState.startedAt);
      expect(slimState.completedAt).toBe(runState.completedAt);
    });
  });
});
