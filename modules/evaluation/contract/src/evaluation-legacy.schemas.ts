import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "@langwatch/evaluator-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

const evaluatorParamsSchemaDefinition = z.object({
  evaluator: z
    .string()
    .describe(
      "Which evaluator to run. Either a built-in id (`ragas/faithfulness`), the slug of a monitor configured in this project, or `evaluators/{slug|id}` for a saved evaluator. `GET /api/evaluations/list` returns the built-in ids.",
    ),
});
export interface EvaluatorParamsSchema extends Named<typeof evaluatorParamsSchemaDefinition> {}
export const evaluatorParamsSchema: EvaluatorParamsSchema = evaluatorParamsSchemaDefinition;

const namespacedEvaluatorParamsSchemaDefinition = z.object({
  evaluator: z.string().describe("First segment of the evaluator id, such as `ragas`"),
  subpath: z.string().describe("Second segment of the evaluator id, such as `faithfulness`"),
});
export interface NamespacedEvaluatorParamsSchema extends Named<
  typeof namespacedEvaluatorParamsSchemaDefinition
> {}
export const namespacedEvaluatorParamsSchema: NamespacedEvaluatorParamsSchema =
  namespacedEvaluatorParamsSchemaDefinition;

const batchEvaluationInputSchemaDefinition = z.object({
  evaluation: z
    .string()
    .describe("Which evaluator to run, addressed the same way the evaluate endpoints address it"),
  experimentSlug: z
    .string()
    .optional()
    .describe(
      "Groups the results under an experiment. Omit it and a batch id is generated instead.",
    ),
  batchId: z
    .string()
    .optional()
    .describe("Older name for experimentSlug, used when that is absent"),
  datasetSlug: z.string().describe("The saved dataset to evaluate"),
  data: z
    .looseObject({})
    .optional()
    .nullable()
    .describe("Extra fields merged into every row before evaluating"),
  settings: z
    .looseObject({})
    .optional()
    .nullable()
    .describe("Per-call overrides of the evaluator's settings"),
});
export interface BatchEvaluationInputSchema extends Named<
  typeof batchEvaluationInputSchemaDefinition
> {}
export const batchEvaluationInputSchema: BatchEvaluationInputSchema =
  batchEvaluationInputSchemaDefinition;

export type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;

/**
 * The body an evaluate door parses.
 * Schema declared here, not imported from @langwatch/evaluator-browser, per value-import boundary.
 */
const evaluationInputSchemaDefinition = z.object({
  trace_id: z
    .string()
    .optional()
    .nullable()
    .describe("Attaches the result to a trace you already sent"),
  evaluation_id: z
    .string()
    .optional()
    .nullable()
    .describe("Supply your own id to make the call idempotent"),
  evaluator_id: z.string().optional().nullable(),
  name: z
    .string()
    .optional()
    .nullable()
    .describe("Overrides the name the result is recorded under"),
  data: z
    .looseObject({})
    .describe(
      "What the evaluator scores. Which fields are required depends on the evaluator; its own entry under Built-in Evaluators lists them.",
    ),
  settings: z
    .looseObject({})
    .optional()
    .nullable()
    .describe(
      "Per-call overrides of the evaluator's settings. Anything omitted falls back to the saved evaluator or monitor, then to the evaluator's own defaults.",
    ),
  as_guardrail: z
    .boolean()
    .optional()
    .nullable()
    .default(false)
    .describe(
      "Evaluate as a guardrail: a skipped or failed evaluation answers `passed` rather than an error, so a caller can gate on one field. The /api/guardrails path sets this for you.",
    ),
});
export interface EvaluationInputSchema extends Named<typeof evaluationInputSchemaDefinition> {}
export const evaluationInputSchema: EvaluationInputSchema = evaluationInputSchemaDefinition;

export type EvaluationRESTParams = z.infer<typeof evaluationInputSchema>;

/**
 * What an evaluate door answers with: the evaluator's own result minus the
 * traceback, plus the guardrail verdict when the call asked for one.
 */
export type EvaluationRESTResult = (
  | EvaluationResult
  | EvaluationResultSkipped
  | Omit<EvaluationResultError, "traceback">
) & {
  passed?: boolean | null;
};

/** Three shapes discriminated by status; error details are stripped at the boundary. */
const evaluateResponseSchemaDefinition = z.union([
  z.object({
    status: z.literal("processed"),
    score: z.number().optional(),
    passed: z.boolean().optional(),
    label: z.string().optional(),
    details: z.string().optional(),
    cost: z
      .object({ currency: z.string(), amount: z.number() })
      .optional()
      .describe("What running the evaluator cost"),
    raw_response: z.unknown().optional().describe("The evaluator's own output, unprocessed"),
  }),
  z.object({
    status: z.literal("skipped"),
    details: z.string().optional().describe("Why the evaluator declined to score this input"),
    cost: z
      .object({ currency: z.string(), amount: z.number() })
      .optional()
      .describe("What the attempt cost, when the evaluator spent money before declining to score"),
    passed: z
      .boolean()
      .optional()
      .describe("Always true in guardrail mode, so a skip does not block"),
  }),
  z.object({
    status: z.literal("error"),
    error_type: z
      .literal("EVALUATOR_ERROR")
      .describe("Constant: the evaluator's own type is not exposed"),
    details: z.string(),
    passed: z
      .boolean()
      .optional()
      .describe("Always true in guardrail mode, so a failure does not block"),
  }),
]);
export interface EvaluateResponseSchema extends Named<typeof evaluateResponseSchemaDefinition> {}
export const evaluateResponseSchema: EvaluateResponseSchema = evaluateResponseSchemaDefinition;

/**
 * A refusal from the evaluate family. `error` is the sentence (long-standing
 * wire shape). A missing field also carries `kind` — the stable
 * `HandledError` code, kept as `kind` for back-compat — and `meta` naming the field.
 */
const evaluateErrorSchemaDefinition = z.object({
  error: z.string().describe("The failure, as a sentence"),
  kind: z.string().optional().describe("Stable failure code, on the failures that carry one"),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("What the code needs to be acted on, such as the missing field"),
});
export interface EvaluateErrorSchema extends Named<typeof evaluateErrorSchemaDefinition> {}
export const evaluateErrorSchema: EvaluateErrorSchema = evaluateErrorSchemaDefinition;

const evaluatorSettingsSchema = z.object({
  name: z.string().describe("Display name of the evaluator"),
  description: z.string(),
  category: z.string(),
  docsUrl: z.string().optional(),
  isGuardrail: z.boolean().describe("Whether this evaluator can gate a request as a guardrail"),
  requiredFields: z.array(z.string()).describe("`data` keys the evaluate call must supply"),
  optionalFields: z.array(z.string()),
  settings: z.record(z.string(), z.unknown()).describe("Each setting's default and description"),
  settings_json_schema: z
    .record(z.string(), z.unknown())
    .describe("JSON Schema for this evaluator's settings object"),
  envVars: z.array(z.string()).describe("Server-side variables the evaluator needs configured"),
  result: z.record(z.string(), z.unknown()).describe("What its score, passed and label mean"),
});

const evaluatorCatalogueResponseSchemaDefinition = z.object({
  evaluators: z
    .record(z.string(), evaluatorSettingsSchema)
    .describe("Keyed by evaluator id, the value you put in the evaluate path"),
});
export interface EvaluatorCatalogueResponseSchema extends Named<
  typeof evaluatorCatalogueResponseSchemaDefinition
> {}
export const evaluatorCatalogueResponseSchema: EvaluatorCatalogueResponseSchema =
  evaluatorCatalogueResponseSchemaDefinition;

/** Legacy error response predating ADR-045: sentences not codes, split between message/error. */
const legacySentenceErrorSchemaDefinition = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});
export interface LegacySentenceErrorSchema extends Named<
  typeof legacySentenceErrorSchemaDefinition
> {}
export const legacySentenceErrorSchema: LegacySentenceErrorSchema =
  legacySentenceErrorSchemaDefinition;

/** What an accepted write answers with when there is nothing to return. */
const acknowledgementSchemaDefinition = z.object({
  message: z.string().describe("Human-readable confirmation"),
});
export interface AcknowledgementSchema extends Named<typeof acknowledgementSchemaDefinition> {}
export const acknowledgementSchema: AcknowledgementSchema = acknowledgementSchemaDefinition;

export const AZURE_SAFETY_PROVIDER_KEY = "azure_safety";

export const AZURE_SAFETY_ENV_VARS = [
  "AZURE_CONTENT_SAFETY_ENDPOINT",
  "AZURE_CONTENT_SAFETY_KEY",
] as const;

export const AZURE_SAFETY_NOT_CONFIGURED_MESSAGE =
  "Azure Safety provider not configured. Configure it in Settings → Model Providers to run this evaluator.";

export function isAzureEvaluatorType(evaluatorType: string): boolean {
  return evaluatorType.startsWith("azure/");
}
