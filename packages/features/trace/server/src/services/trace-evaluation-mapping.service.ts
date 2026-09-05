import { TraceSafeJsonService } from "./trace-safe-json.service";
import type { TraceEvaluationData as TraceEvaluation } from "@langwatch/evaluation-contract";
import type { Evaluation } from "@langwatch/trace-contract";

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
  Inputs: string | null;
  ScheduledAt: string | null; // DateTime64(3) as string
  StartedAt: string | null;
  CompletedAt: string | null;
  LastProcessedEventId: string;
  UpdatedAt: string;
}

/**
 * evaluation_runs columns backing {@link ClickHouseEvaluationRunRow}, minus the heavy `Inputs` payload — keep in sync with the interface above. Reading these explicitly avoids `SELECT *`, which also pulls columns no reader consumes and, on the deduped read path, pulls them across every stale version before the IN-tuple discards it.
 */
export const EVALUATION_RUN_COLUMNS_LIGHT = [
  "ProjectionId",
  "TenantId",
  "EvaluationId",
  "Version",
  "EvaluatorId",
  "EvaluatorType",
  "EvaluatorName",
  "TraceId",
  "IsGuardrail",
  "Status",
  "Score",
  "Passed",
  "Label",
  "Details",
  "Error",
  "ScheduledAt",
  "StartedAt",
  "CompletedAt",
  "LastProcessedEventId",
  "UpdatedAt",
].join(", ");

/** Light columns plus the heavy `Inputs` payload. */
export const EVALUATION_RUN_COLUMNS_WITH_INPUTS = `${EVALUATION_RUN_COLUMNS_LIGHT}, Inputs`;

/** Appends "Z" to a timestamp string only when it lacks a timezone indicator. */
function appendUtcSuffix(ts: string): string {
  return /[Zz]$|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z";
}

export class TraceEvaluationMappingService {
  static create(): TraceEvaluationMappingService {
    return new TraceEvaluationMappingService();
  }

  /**
   * Maps a ClickHouse evaluation_runs row to the canonical TraceEvaluation type.
   * @param record - A row from the evaluation_runs table
   * @returns TraceEvaluation in camelCase
   */
  static mapClickHouseEvaluationToTraceEvaluation(
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
      inputs: TraceSafeJsonService.trySafeJsonParse(record.Inputs),
      timestamps: {
        // CH DateTime64(3) returns UTC strings without timezone suffix; append "Z" only when missing
        scheduledAt: record.ScheduledAt
          ? new Date(appendUtcSuffix(record.ScheduledAt)).getTime()
          : null,
        startedAt: record.StartedAt ? new Date(appendUtcSuffix(record.StartedAt)).getTime() : null,
        completedAt: record.CompletedAt
          ? new Date(appendUtcSuffix(record.CompletedAt)).getTime()
          : null,
      },
    };
  }

  /**
   * Maps a legacy ES Evaluation (snake_case, `error: ErrorCapture | null` reduced to just the message string) to the canonical TraceEvaluation type.
   * @param evaluation - An Evaluation from the ES trace data
   * @param traceId - The trace ID this evaluation belongs to
   */
  static mapEsEvaluationToTraceEvaluation(
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
   * Reverse mapper: converts TraceEvaluation records back to legacy Evaluation format for backward compatibility with existing callers (e.g. TraceService).
   * @param result - Record of traceId to TraceEvaluation arrays
   * @returns Record of traceId to legacy Evaluation arrays
   */
  static mapTraceEvaluationsToLegacyEvaluations(
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
        inputs: te.inputs,
        timestamps: {
          inserted_at: te.timestamps.scheduledAt,
          started_at: te.timestamps.startedAt,
          finished_at: te.timestamps.completedAt,
        },
      }));
    }

    return output;
  }
}
