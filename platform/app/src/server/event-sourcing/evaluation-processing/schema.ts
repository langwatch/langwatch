import { z } from "zod";

const EVALUATION_STATUSES = [
  "in_progress",
  "processed",
  "error",
  "skipped",
] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

/**
 * The slim per-evaluation dimensions `evaluation_analytics` carries. What an
 * evaluation reports in full — inputs, details, error text — travels on the
 * events and stays in `event_log`.
 *
 * `occurredAt` is the earliest event time observed: the evaluation's start and
 * the row's storage anchor. `completedAt` is the terminal event's own time.
 * Both are epoch milliseconds where `0` means "not yet".
 */
export const evaluationStateSchema = z.object({
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable(),
  status: z.enum(EVALUATION_STATUSES),
  isGuardrail: z.boolean(),
  passed: z.boolean().nullable(),
  score: z.number().nullable(),
  label: z.string().nullable(),
  traceId: z.string().nullable(),
  attributes: z.record(z.string()),
  occurredAt: z.number(),
  completedAt: z.number(),
});
export type EvaluationState = z.infer<typeof evaluationStateSchema>;

const evaluationIdentitySchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
  isGuardrail: z.boolean().optional(),
  /** The emitting process's own clock — a fold reads only an event's own
   * `data`, so any timing it needs is event-carried. */
  occurredAt: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export const evaluationStartedDataSchema = evaluationIdentitySchema;
export type EvaluationStartedData = z.infer<typeof evaluationStartedDataSchema>;

export const evaluationReportedDataSchema = evaluationIdentitySchema.merge(
  z.object({
    status: z.enum(["processed", "error", "skipped"]),
    score: z.number().nullable().optional(),
    passed: z.boolean().nullable().optional(),
    label: z.string().nullable().optional(),
    details: z.string().nullable().optional(),
    /** The evaluator's raw inputs, or a stored-object offload marker — both
     * are ordinary JSON objects and nothing downstream tells them apart. */
    inputs: z.record(z.unknown()).nullable().optional(),
    error: z.string().nullable().optional(),
    errorDetails: z.string().nullable().optional(),
    costId: z.string().nullable().optional(),
  }),
);
export type EvaluationReportedData = z.infer<
  typeof evaluationReportedDataSchema
>;
