/**
 * Canonical camelCase type for per-trace evaluation state.
 *
 * This is the public API type returned by EvaluationService.
 * Internal backends (ClickHouse, Elasticsearch) map their native
 * formats to this type via mappers.
 */
export interface TraceEvaluation {
  evaluationId: string;
  evaluatorId: string;
  evaluatorType: string;
  evaluatorName: string | null;
  traceId: string | null;
  isGuardrail: boolean;
  status: "scheduled" | "in_progress" | "processed" | "error" | "skipped";
  score: number | null;
  passed: boolean | null;
  label: string | null;
  details: string | null;
  error: string | null;
  timestamps: {
    scheduledAt: number | null;
    startedAt: number | null;
    completedAt: number | null;
  };
}
