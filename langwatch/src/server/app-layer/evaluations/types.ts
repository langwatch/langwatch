import { z } from "zod";

// ---------------------------------------------------------------------------
// Evaluation Run (write + read)
// ---------------------------------------------------------------------------

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
  error: z.string().nullable(),
  scheduledAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  costId: z.string().nullable(),
});

export type EvaluationRunData = z.infer<typeof evaluationRunDataSchema>;
