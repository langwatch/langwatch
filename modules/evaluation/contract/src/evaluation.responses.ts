/**
 * What the evaluation tRPC surface answers with: an evaluator's own
 * definition plus two per-deployment facts — which env vars are unset here,
 * and why it cannot run — kept with the answer, not the definition.
 */
import { singleEvaluationResultSchema } from "@langwatch/evaluator-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { evaluationOutcomeCursorSchema } from "./evaluation.queries.ts";

/** Why an evaluator cannot run on this install, in the reader's terms. */
const evaluatorUnavailabilitySchemaDefinition = z.object({
  /** What is true, in the person's terms. */
  reason: z.string(),
  /** What they do about it. */
  howToEnable: z.string(),
});
export interface EvaluatorUnavailabilitySchema extends Named<
  typeof evaluatorUnavailabilitySchemaDefinition
> {}
export const evaluatorUnavailabilitySchema: EvaluatorUnavailabilitySchema =
  evaluatorUnavailabilitySchemaDefinition;
export type EvaluatorUnavailability = z.infer<typeof evaluatorUnavailabilitySchema>;

/** One evaluator as the picker lists it. */
const evaluatorCatalogueEntrySchemaDefinition = z.looseObject({
  name: z.string(),
  description: z.string(),
  category: z.string(),
  docsUrl: z.string().optional(),
  isGuardrail: z.boolean(),
  requiredFields: z.array(z.string()),
  optionalFields: z.array(z.string()),
  envVars: z.array(z.string()),
  missingEnvVars: z.array(z.string()),
  unavailable: evaluatorUnavailabilitySchema.optional(),
});
export interface EvaluatorCatalogueEntrySchema extends Named<
  typeof evaluatorCatalogueEntrySchemaDefinition
> {}
export const evaluatorCatalogueEntrySchema: EvaluatorCatalogueEntrySchema =
  evaluatorCatalogueEntrySchemaDefinition;

/** Every evaluator LangWatch knows, keyed by its type. */
const evaluatorCatalogueSchemaDefinition = z.record(z.string(), evaluatorCatalogueEntrySchema);
export interface EvaluatorCatalogueSchema extends Named<
  typeof evaluatorCatalogueSchemaDefinition
> {}
export const evaluatorCatalogueSchema: EvaluatorCatalogueSchema =
  evaluatorCatalogueSchemaDefinition;
export type EvaluatorCatalogue = z.infer<typeof evaluatorCatalogueSchema>;

/**
 * One run's result, plus the two fields the trace-side runner adds to it.
 */
const evaluationRunOutcomeSchemaDefinition = z.intersection(
  singleEvaluationResultSchema,
  z.object({
    evaluation_thread_id: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
  }),
);
export interface EvaluationRunOutcomeSchema extends Named<
  typeof evaluationRunOutcomeSchemaDefinition
> {}
export const evaluationRunOutcomeSchema: EvaluationRunOutcomeSchema =
  evaluationRunOutcomeSchemaDefinition;
export type EvaluationRunOutcome = z.infer<typeof evaluationRunOutcomeSchema>;

/** What the evaluator-runtime warm-up answers with. */
const evaluationWarmupSchemaDefinition = z.object({ success: z.boolean(), count: z.number() });
export interface EvaluationWarmupSchema extends Named<typeof evaluationWarmupSchemaDefinition> {}
export const evaluationWarmupSchema: EvaluationWarmupSchema = evaluationWarmupSchemaDefinition;
export type EvaluationWarmup = z.infer<typeof evaluationWarmupSchema>;

/** Which of an evaluator's records a run reads its settings from. */
export const evaluatorSettingsSourceSchema = z.enum([
  "config-settings",
  "top-level-recovery",
  "monitor-parameters",
]);
export type EvaluatorSettingsSource = z.infer<typeof evaluatorSettingsSourceSchema>;

/**
 * One finished evaluation's outcome on its trace: `occurredAt` and `lastEventId` are the last
 * event its run applied, so a peer orders it the way the live event would be ordered.
 */
const evaluationOutcomeSchemaDefinition = z.object({
  evaluationId: z.string(),
  traceId: z.string(),
  evaluatorName: z.string().nullable(),
  isGuardrail: z.boolean(),
  status: z.enum(["processed", "error", "skipped"]),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  occurredAt: z.number().int(),
  lastEventId: z.string(),
});
export interface EvaluationOutcomeSchema extends Named<typeof evaluationOutcomeSchemaDefinition> {}
export const evaluationOutcomeSchema: EvaluationOutcomeSchema = evaluationOutcomeSchemaDefinition;
export type EvaluationOutcome = z.infer<typeof evaluationOutcomeSchema>;

/** A page of outcomes; `next` resumes after its last, null once none are left. */
const evaluationOutcomePageSchemaDefinition = z.object({
  outcomes: z.array(evaluationOutcomeSchema),
  next: evaluationOutcomeCursorSchema.nullable(),
});
export interface EvaluationOutcomePageSchema extends Named<
  typeof evaluationOutcomePageSchemaDefinition
> {}
export const evaluationOutcomePageSchema: EvaluationOutcomePageSchema =
  evaluationOutcomePageSchemaDefinition;
export type EvaluationOutcomePage = z.infer<typeof evaluationOutcomePageSchema>;
