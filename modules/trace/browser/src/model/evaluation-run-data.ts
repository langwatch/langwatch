/**
 * One evaluation run, as a sample trace carries it.
 */

import type { TimeInput } from "@langwatch/time";

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
  scheduledAt?: TimeInput | null;
  startedAt?: TimeInput | null;
  completedAt?: TimeInput | null;
  archivedAt?: TimeInput | null;
  createdAt?: TimeInput | null;
  updatedAt?: TimeInput | null;
  LastEventOccurredAt?: TimeInput | null;
};
