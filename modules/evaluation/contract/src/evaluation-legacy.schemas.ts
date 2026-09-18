import type {
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
} from "@langwatch/evaluator-contract";
import { z } from "zod";

export const evaluatorParamsSchema = z.object({
  evaluator: z
    .string()
    .describe(
      "Which evaluator to run. Either a built-in id (`ragas/faithfulness`), the slug of a monitor configured in this project, or `evaluators/{slug|id}` for a saved evaluator. `GET /api/evaluations/list` returns the built-in ids.",
    ),
});

export const namespacedEvaluatorParamsSchema = z.object({
  evaluator: z.string().describe("First segment of the evaluator id, such as `ragas`"),
  subpath: z.string().describe("Second segment of the evaluator id, such as `faithfulness`"),
});

export const batchEvaluationInputSchema = z.object({
  evaluation: z.string(),
  experimentSlug: z.string().optional(),
  batchId: z.string().optional(),
  datasetSlug: z.string(),
  data: z.looseObject({}).optional().nullable(),
  settings: z.looseObject({}).optional().nullable(),
});

export type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;

/**
 * The body an evaluate door parses.
 * Schema declared here, not imported from @langwatch/evaluator-browser, per value-import boundary.
 */
export const evaluationInputSchema = z.object({
  trace_id: z.string().optional().nullable(),
  evaluation_id: z.string().optional().nullable(),
  evaluator_id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  data: z.looseObject({}).optional().nullable(),
  settings: z.looseObject({}).optional().nullable(),
  as_guardrail: z.boolean().optional().nullable().default(false),
});

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
  passed?: boolean;
};

/** Three shapes discriminated by status; error details are stripped at the boundary. */
export const evaluateResponseSchema = z.union([
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

/**
 * A refusal from the evaluate family. `error` is the sentence (long-standing
 * wire shape). A missing field also carries `kind` — the stable
 * `HandledError` code, kept as `kind` for back-compat — and `meta` naming the field.
 */
export const evaluateErrorSchema = z.object({
  error: z.string().describe("The failure, as a sentence"),
  kind: z.string().optional().describe("Stable failure code, on the failures that carry one"),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("What the code needs to be acted on, such as the missing field"),
});

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

export const evaluatorCatalogueResponseSchema = z.object({
  evaluators: z
    .record(z.string(), evaluatorSettingsSchema)
    .describe("Keyed by evaluator id, the value you put in the evaluate path"),
});

/** Legacy error response predating ADR-045: sentences not codes, split between message/error. */
export const legacySentenceErrorSchema = z.object({
  message: z.string().optional().describe("Set when the request was rejected before validation"),
  error: z.string().optional().describe("Set when the body parsed and then failed validation"),
});

/** What an accepted write answers with when there is nothing to return. */
export const acknowledgementSchema = z.object({
  message: z.string().describe("Human-readable confirmation"),
});
