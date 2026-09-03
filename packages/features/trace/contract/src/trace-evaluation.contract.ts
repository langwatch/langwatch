import { z } from "zod";

/** The span fields consumed by Evaluation preconditions and evaluator gating. */
export const evaluationTraceSpanSchema = z
  .object({
    type: z.string(),
    model: z.string().nullable(),
    ragContextTexts: z.array(z.string()),
  })
  .strict();

export type EvaluationTraceSpan = z.infer<typeof evaluationTraceSpanSchema>;

/** The legacy event-compatible values consumed by Evaluation preconditions. */
export const evaluationTraceEventSchema = z
  .object({
    eventType: z.string(),
    metrics: z.array(z.object({ key: z.string(), value: z.number() })),
    details: z.array(z.object({ key: z.string(), value: z.string() })),
  })
  .strict();

export type EvaluationTraceEvent = z.infer<typeof evaluationTraceEventSchema>;

export const evaluationTraceReadInputSchema = z
  .object({
    tenantId: z.string().min(1),
    traceId: z.string().min(1),
    occurredAtMs: z.number().int().optional(),
  })
  .strict();

export type EvaluationTraceReadInput = z.infer<typeof evaluationTraceReadInputSchema>;
