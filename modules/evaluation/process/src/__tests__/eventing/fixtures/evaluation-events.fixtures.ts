import type {
  EvaluationCompletedEvent,
  EvaluationReportedEvent,
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
} from "@langwatch/evaluation-contract";
import {
  evaluationCompletedEventSchema,
  evaluationReportedEventSchema,
  evaluationScheduledEventSchema,
  evaluationStartedEventSchema,
} from "@langwatch/evaluation-contract";

/**
 * Builders for the four evaluation lifecycle events, shared by the fold's own
 * suites. Every field a test varies is an option; the defaults describe one
 * `langevals/llm_answer_match` run on `eval-1`.
 */

const DEFAULT_TENANT = "proj-eval";
const DEFAULT_EVALUATION_ID = "eval-1";

interface CommonOptions {
  eventId?: string;
  tenantId?: string;
  evaluationId?: string;
  occurredAt?: number;
  metadata?: Record<string, unknown>;
}

interface IdentityOptions extends CommonOptions {
  evaluatorId?: string;
  evaluatorType?: string;
  evaluatorName?: string;
  traceId?: string;
  isGuardrail?: boolean;
}

interface OutcomeOptions {
  status?: "processed" | "error" | "skipped";
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
  /** Heavy fields the slim fold must drop — present so tests can prove it does. */
  details?: string;
  inputs?: Record<string, unknown>;
  error?: string;
  errorDetails?: string;
  costId?: string;
}

function envelope({
  type,
  options,
  fallbackEventId,
}: {
  type: string;
  options: CommonOptions;
  fallbackEventId: string;
}) {
  return {
    type,
    id: options.eventId ?? fallbackEventId,
    tenantId: options.tenantId ?? DEFAULT_TENANT,
    aggregateId: options.evaluationId ?? DEFAULT_EVALUATION_ID,
    aggregateType: "evaluation",
    createdAt: options.occurredAt ?? 1_000_000,
    occurredAt: options.occurredAt ?? 1_000_000,
    version: "2025-01-14",
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

export function createEvaluationScheduledEvent(
  options: IdentityOptions = {},
): EvaluationScheduledEvent {
  return evaluationScheduledEventSchema.parse({
    ...envelope({
      type: "lw.evaluation.scheduled",
      options,
      fallbackEventId: "evt-1",
    }),
    data: {
      evaluationId: options.evaluationId ?? DEFAULT_EVALUATION_ID,
      evaluatorId: options.evaluatorId ?? "monitor-x",
      evaluatorType: options.evaluatorType ?? "langevals/llm_answer_match",
      evaluatorName: options.evaluatorName ?? "Judge",
      traceId: options.traceId ?? "trace-1",
      isGuardrail: options.isGuardrail ?? false,
    },
  });
}

export function createEvaluationStartedEvent(
  options: IdentityOptions = {},
): EvaluationStartedEvent {
  return evaluationStartedEventSchema.parse({
    ...envelope({
      type: "lw.evaluation.started",
      options,
      fallbackEventId: "evt-2",
    }),
    data: {
      evaluationId: options.evaluationId ?? DEFAULT_EVALUATION_ID,
      evaluatorId: options.evaluatorId ?? "monitor-x",
      evaluatorType: options.evaluatorType ?? "langevals/llm_answer_match",
      ...(options.evaluatorName === undefined
        ? {}
        : { evaluatorName: options.evaluatorName }),
      ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
      ...(options.isGuardrail === undefined
        ? {}
        : { isGuardrail: options.isGuardrail }),
    },
  });
}

export function createEvaluationCompletedEvent(
  options: CommonOptions & OutcomeOptions = {},
): EvaluationCompletedEvent {
  return evaluationCompletedEventSchema.parse({
    ...envelope({
      type: "lw.evaluation.completed",
      options,
      fallbackEventId: "evt-3",
    }),
    data: {
      evaluationId: options.evaluationId ?? DEFAULT_EVALUATION_ID,
      status: options.status ?? "processed",
      score: options.score === undefined ? 0.85 : options.score,
      passed: options.passed === undefined ? true : options.passed,
      label: options.label === undefined ? "good" : options.label,
      details:
        options.details ?? "(redacted detail blob that the slim should drop)",
      inputs: options.inputs ?? { conversation: "(big blob)" },
      costId: options.costId ?? "cost-1",
    },
  });
}

export function createEvaluationReportedEvent(
  options: IdentityOptions & OutcomeOptions = {},
): EvaluationReportedEvent {
  return evaluationReportedEventSchema.parse({
    ...envelope({
      type: "lw.evaluation.reported",
      options,
      fallbackEventId: "evt-r",
    }),
    data: {
      evaluationId: options.evaluationId ?? DEFAULT_EVALUATION_ID,
      evaluatorId: options.evaluatorId ?? "monitor-y",
      evaluatorType: options.evaluatorType ?? "langevals/custom",
      evaluatorName: options.evaluatorName ?? "Custom",
      traceId: options.traceId ?? "trace-9",
      isGuardrail: options.isGuardrail ?? true,
      status: options.status ?? "error",
      score: options.score === undefined ? null : options.score,
      passed: options.passed === undefined ? null : options.passed,
      label: options.label === undefined ? null : options.label,
      error: options.error ?? "boom",
      errorDetails: options.errorDetails ?? "(stack trace)",
      ...(options.costId === undefined ? {} : { costId: options.costId }),
    },
  });
}
