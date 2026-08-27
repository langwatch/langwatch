import { createLogger } from "@langwatch/observability";
import type { EvaluationAnalyticsAttributePolicy } from "../ports/evaluation.port";

const logger = createLogger(
  "langwatch:event-sourcing:evaluation-processing:evaluation-analytics-fold",
);

/** Persisted shape for one evaluation in the slim evaluation_analytics table. */
export interface EvaluationAnalyticsRow {
  tenantId: string;
  evaluationId: string;
  version: string;
  occurredAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  evaluatorType: string;
  evaluatorName: string | null;
  status: string;
  isGuardrail: boolean;
  passed: boolean | null;
  score: number | null;
  label: string | null;
  model: string | null;
  traceId: string | null;
  userId: string | null;
  conversationId: string | null;
  customerId: string | null;
  origin: string | null;
  durationMs: number;
  totalCost: number | null;
  nonBilledCost: number | null;
  attributes: Record<string, string>;
  startedAtMs: number | null;
  completedAtMs: number | null;
}

/** Fold state needed to derive the slim row. Heavy evaluator artifacts stay in evaluation_runs. */
export interface EvaluationAnalyticsData {
  evaluationId: string;
  evaluatorId: string;
  evaluatorType: string;
  evaluatorName: string | null;
  status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";
  isGuardrail: boolean;
  passed: boolean | null;
  score: number | null;
  label: string | null;
  model: string | null;
  traceId: string | null;
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  costId: string | null;
  attributes: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

/** Pure state/row codec kept separate from the event fold. */
export class EvaluationAnalyticsRowProjection {
  static create(): EvaluationAnalyticsRowProjection {
    return new EvaluationAnalyticsRowProjection();
  }

  project({
    state,
    tenantId,
    version,
    attributePolicy,
  }: {
    state: EvaluationAnalyticsData;
    tenantId: string;
    version: string;
    attributePolicy: EvaluationAnalyticsAttributePolicy;
  }): EvaluationAnalyticsRow {
    const durationMs =
      state.completedAt !== null && state.startedAt !== null
        ? Math.max(0, state.completedAt - state.startedAt)
        : 0;

    return {
      tenantId,
      evaluationId: state.evaluationId,
      version,
      occurredAtMs: state.LastEventOccurredAt,
      createdAtMs: state.createdAt,
      updatedAtMs: state.updatedAt,
      evaluatorType: state.evaluatorType,
      evaluatorName: state.evaluatorName,
      status: state.status,
      isGuardrail: state.isGuardrail,
      passed: state.passed,
      score: state.score,
      label: state.label,
      model: state.model,
      traceId: state.traceId,
      userId: null,
      conversationId: null,
      customerId: null,
      origin: null,
      durationMs,
      totalCost: null,
      nonBilledCost: null,
      attributes: attributePolicy.trim(state.attributes ?? {}),
      startedAtMs: state.startedAt,
      completedAtMs: state.completedAt,
    };
  }

  fromRow(row: EvaluationAnalyticsRow): EvaluationAnalyticsData {
    const statusValues: ReadonlySet<EvaluationAnalyticsData["status"]> = new Set([
      "scheduled",
      "in_progress",
      "processed",
      "error",
      "skipped",
    ]);
    const isKnownStatus = statusValues.has(row.status as EvaluationAnalyticsData["status"]);
    if (!isKnownStatus) {
      logger.warn(
        { tenantId: row.tenantId, evaluationId: row.evaluationId, status: row.status },
        "evaluation_analytics read-back saw an unknown status; coercing to scheduled",
      );
    }

    return {
      evaluationId: row.evaluationId,
      evaluatorId: "",
      evaluatorType: row.evaluatorType,
      evaluatorName: row.evaluatorName,
      status: isKnownStatus ? (row.status as EvaluationAnalyticsData["status"]) : "scheduled",
      isGuardrail: row.isGuardrail,
      passed: row.passed,
      score: row.score,
      label: row.label,
      model: row.model,
      traceId: row.traceId,
      scheduledAt: null,
      startedAt: row.startedAtMs,
      completedAt: row.completedAtMs,
      costId: null,
      attributes: row.attributes,
      createdAt: row.createdAtMs,
      updatedAt: row.updatedAtMs,
      LastEventOccurredAt: row.occurredAtMs,
    };
  }
}
