import type { Evaluation } from "~/server/tracer/types";
import type { TraceEvaluation } from "./evaluation-run.types";

/**
 * ClickHouse evaluation_runs row shape (PascalCase, matching the table schema).
 */
export interface ClickHouseEvaluationRunRow {
  ProjectionId: string;
  TenantId: string;
  EvaluationId: string;
  Version: string;
  EvaluatorId: string;
  EvaluatorType: string;
  EvaluatorName: string | null;
  TraceId: string | null;
  IsGuardrail: number; // UInt8
  Status: string;
  Score: number | null;
  Passed: number | null; // Nullable(UInt8)
  Label: string | null;
  Details: string | null;
  Error: string | null;
  ScheduledAt: string | null; // DateTime64(3) as string
  StartedAt: string | null;
  CompletedAt: string | null;
  LastProcessedEventId: string;
  UpdatedAt: string;
}

/**
 * Maps a ClickHouse evaluation_runs row to the canonical TraceEvaluation type.
 *
 * @param record - A row from the evaluation_runs table
 * @returns TraceEvaluation in camelCase
 */
export function mapClickHouseEvaluationToTraceEvaluation(
  record: ClickHouseEvaluationRunRow,
): TraceEvaluation {
  return {
    evaluationId: record.EvaluationId,
    evaluatorId: record.EvaluatorId,
    evaluatorType: record.EvaluatorType,
    evaluatorName: record.EvaluatorName,
    traceId: record.TraceId,
    isGuardrail: record.IsGuardrail === 1,
    status: record.Status as TraceEvaluation["status"],
    score: record.Score,
    passed: record.Passed === null ? null : record.Passed === 1,
    label: record.Label,
    details: record.Details,
    error: record.Error,
    timestamps: {
      // CH DateTime64(3) returns UTC strings without timezone suffix; append "Z" only when missing
      scheduledAt: record.ScheduledAt
        ? new Date(appendUtcSuffix(record.ScheduledAt)).getTime()
        : null,
      startedAt: record.StartedAt
        ? new Date(appendUtcSuffix(record.StartedAt)).getTime()
        : null,
      completedAt: record.CompletedAt
        ? new Date(appendUtcSuffix(record.CompletedAt)).getTime()
        : null,
    },
  };
}

/**
 * Maps a legacy ES Evaluation (snake_case) to the canonical TraceEvaluation type.
 *
 * The ES Evaluation type has error as ErrorCapture | null. We extract just the
 * message string for the canonical type.
 *
 * @param evaluation - An Evaluation from the ES trace data
 * @param traceId - The trace ID this evaluation belongs to
 * @returns TraceEvaluation in camelCase
 */
export function mapEsEvaluationToTraceEvaluation(
  evaluation: Evaluation,
  traceId: string,
): TraceEvaluation {
  return {
    evaluationId: evaluation.evaluation_id,
    evaluatorId: evaluation.evaluator_id,
    evaluatorType: evaluation.type ?? "",
    evaluatorName: evaluation.name ?? null,
    traceId,
    isGuardrail: evaluation.is_guardrail === true,
    status: evaluation.status,
    score: evaluation.score ?? null,
    passed: evaluation.passed ?? null,
    label: evaluation.label ?? null,
    details: evaluation.details ?? null,
    error: evaluation.error ? evaluation.error.message : null,
    timestamps: {
      scheduledAt: evaluation.timestamps.inserted_at ?? null,
      startedAt: evaluation.timestamps.started_at ?? null,
      completedAt: evaluation.timestamps.finished_at ?? null,
    },
  };
}

/**
 * Reverse mapper: converts TraceEvaluation records back to legacy Evaluation format
 * for backward compatibility with existing callers (e.g. TraceService).
 *
 * @param result - Record of traceId to TraceEvaluation arrays
 * @returns Record of traceId to legacy Evaluation arrays
 */
export function mapTraceEvaluationsToLegacyEvaluations(
  result: Record<string, TraceEvaluation[]>,
): Record<string, Evaluation[]> {
  const output: Record<string, Evaluation[]> = {};

  for (const [traceId, evaluations] of Object.entries(result)) {
    output[traceId] = evaluations.map((te) => ({
      evaluation_id: te.evaluationId,
      evaluator_id: te.evaluatorId,
      name: te.evaluatorName ?? "",
      type: te.evaluatorType,
      is_guardrail: te.isGuardrail,
      status: te.status,
      passed: te.passed,
      score: te.score,
      label: te.label,
      details: te.details,
      error: te.error ? { has_error: true as const, message: te.error, stacktrace: [] } : null,
      timestamps: {
        inserted_at: te.timestamps.scheduledAt,
        started_at: te.timestamps.startedAt,
        finished_at: te.timestamps.completedAt,
      },
    }));
  }

  return output;
}

/** Appends "Z" to a timestamp string only when it lacks a timezone indicator. */
function appendUtcSuffix(ts: string): string {
  return /[Zz]$|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z";
}
