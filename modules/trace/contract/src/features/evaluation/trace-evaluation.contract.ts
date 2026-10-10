import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The span fields consumed by Evaluation preconditions and evaluator gating. */
const evaluationTraceSpanSchemaDefinition = z
  .object({
    type: z.string(),
    model: z.string().nullable(),
    ragContextTexts: z.array(z.string()),
  })
  .strict();
export interface EvaluationTraceSpanSchema extends Named<
  typeof evaluationTraceSpanSchemaDefinition
> {}
export const evaluationTraceSpanSchema: EvaluationTraceSpanSchema =
  evaluationTraceSpanSchemaDefinition;

export type EvaluationTraceSpan = z.infer<typeof evaluationTraceSpanSchema>;

/** The legacy event-compatible values consumed by Evaluation preconditions. */
const evaluationTraceEventSchemaDefinition = z
  .object({
    eventType: z.string(),
    metrics: z.array(z.object({ key: z.string(), value: z.number() })),
    details: z.array(z.object({ key: z.string(), value: z.string() })),
  })
  .strict();
export interface EvaluationTraceEventSchema extends Named<
  typeof evaluationTraceEventSchemaDefinition
> {}
export const evaluationTraceEventSchema: EvaluationTraceEventSchema =
  evaluationTraceEventSchemaDefinition;

export type EvaluationTraceEvent = z.infer<typeof evaluationTraceEventSchema>;

const evaluationTraceReadInputSchemaDefinition = z
  .object({
    tenantId: z.string().min(1),
    traceId: z.string().min(1),
    occurredAtMs: z.number().int().optional(),
  })
  .strict();
export interface EvaluationTraceReadInputSchema extends Named<
  typeof evaluationTraceReadInputSchemaDefinition
> {}
export const evaluationTraceReadInputSchema: EvaluationTraceReadInputSchema =
  evaluationTraceReadInputSchemaDefinition;

export type EvaluationTraceReadInput = z.infer<typeof evaluationTraceReadInputSchema>;
