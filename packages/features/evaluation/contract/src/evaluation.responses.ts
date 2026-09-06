/**
 * What the evaluation tRPC surface answers with.
 *
 * The catalogue entry is an evaluator's own definition plus the two facts this
 * install adds to it: which of its environment variables are unset here, and
 * why it cannot run at all. Both live with the answer rather than with the
 * definition, because both are about THIS deployment.
 */
import { singleEvaluationResultSchema } from "@langwatch/evaluator-contract";
import { z } from "zod";

/** Why an evaluator cannot run on this install, in the reader's terms. */
export const evaluatorUnavailabilitySchema = z.object({
  /** What is true, in the person's terms. */
  reason: z.string(),
  /** What they do about it. */
  howToEnable: z.string(),
});
export type EvaluatorUnavailability = z.infer<typeof evaluatorUnavailabilitySchema>;

/** One evaluator as the picker lists it. */
export const evaluatorCatalogueEntrySchema = z.looseObject({
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

/** Every evaluator LangWatch knows, keyed by its type. */
export const evaluatorCatalogueSchema = z.record(z.string(), evaluatorCatalogueEntrySchema);

/**
 * One run's result, plus the two fields the trace-side runner adds to it.
 */
export const evaluationRunOutcomeSchema = z.intersection(
  singleEvaluationResultSchema,
  z.object({
    evaluation_thread_id: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
  }),
);

/** What the evaluator-runtime warm-up answers with. */
export const evaluationWarmupSchema = z.object({ success: z.boolean(), count: z.number() });
