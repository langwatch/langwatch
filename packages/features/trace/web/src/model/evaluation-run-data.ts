/**
 * One evaluation run, as a sample trace carries it.
 *
 * Declared in `~/server/app-layer/evaluations/types`, which a browser package
 * may not reach. Only the onboarding sample descriptors name it — the rows the
 * empty state shows before a project has ingested anything — so the shape is
 * what those rows state, with the alignment obligation the data-governance
 * snapshots record.
 */

export type EvaluationRunData = {
  evaluationId: string;
  traceId?: string;
  evaluatorId?: string | null;
  evaluatorType?: string | null;
  evaluatorName?: string | null;
  isGuardrail?: boolean | null;
  status?: string | null;
  passed?: boolean | null;
  score?: number | null;
  label?: string | null;
  details?: string | null;
  error?: string | null;
  errorDetails?: unknown;
  inputs?: Record<string, unknown> | null;
  costId?: string | null;
  scheduledAt?: number | Date | null;
  startedAt?: number | Date | null;
  completedAt?: number | Date | null;
  archivedAt?: number | Date | null;
  createdAt?: number | Date | null;
  updatedAt?: number | Date | null;
  LastEventOccurredAt?: number | Date | null;
};
