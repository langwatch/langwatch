import { z } from "zod";

// Duplicate of evaluation-contract's evaluationRunDataSchema (evaluation.ts); keep in step.
export const evaluationRunDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable(),
  traceId: z.string().nullable(),
  isGuardrail: z.boolean(),
  status: z.enum(["scheduled", "in_progress", "processed", "error", "skipped"]),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  details: z.string().nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  errorDetails: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  LastEventOccurredAt: z.number(),
  archivedAt: z.number().nullable(),
  scheduledAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  costId: z.string().nullable(),
});

// Duplicate of evaluation-contract's evaluationSummarySchema (evaluation.ts); keep in step.
export const evaluationSummarySchema = evaluationRunDataSchema.pick({
  evaluationId: true,
  evaluatorId: true,
  evaluatorType: true,
  evaluatorName: true,
  traceId: true,
  isGuardrail: true,
  status: true,
  score: true,
  passed: true,
  label: true,
});
