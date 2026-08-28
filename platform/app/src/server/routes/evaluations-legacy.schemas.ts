/**
 * OpenAPI schemas for the evaluate family.
 *
 * `POST /api/evaluations/{evaluator}/evaluate`, its two-segment form, and
 * `POST /api/guardrails/{evaluator}/evaluate` all run one handler over one
 * request envelope, so one set of schemas serves all three; only what the
 * handler does with `as_guardrail` differs.
 *
 * The per-evaluator detail — which `data` fields an evaluator needs, and what
 * its `settings` accept — is generated separately into `openapi-evals.json`
 * and rendered under Built-in Evaluators. That is why `data` and `settings`
 * are open objects here: this document describes the call, and that one
 * describes the evaluators you can address with it.
 *
 * These do not validate anything at runtime; the handler keeps its parsing.
 */

import { z } from "zod";

export const evaluateRequestSchema = z.object({
  data: z
    .record(z.string(), z.unknown())
    .describe(
      "What the evaluator scores. Which fields are required depends on the evaluator; its own entry under Built-in Evaluators lists them.",
    ),
  settings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Per-call overrides of the evaluator's settings. Anything omitted falls back to the saved evaluator or monitor, then to the evaluator's own defaults.",
    ),
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
  as_guardrail: z
    .boolean()
    .optional()
    .nullable()
    .describe(
      "Evaluate as a guardrail: a skipped or failed evaluation answers `passed` rather than an error, so a caller can gate on one field. The /api/guardrails path sets this for you.",
    ),
});

/**
 * What one evaluation answers with.
 *
 * Three shapes, discriminated by `status`. `traceback` is stripped from the
 * error variant before it leaves the boundary and `error_type` is rewritten to
 * a constant, so a caller sees that an evaluator failed without seeing our
 * stack. As a guardrail, all three carry `passed`, which is the whole point of
 * the mode: gate on one boolean regardless of whether the evaluator ran.
 */
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
    raw_response: z
      .unknown()
      .optional()
      .describe("The evaluator's own output, unprocessed"),
  }),
  z.object({
    status: z.literal("skipped"),
    details: z
      .string()
      .optional()
      .describe("Why the evaluator declined to score this input"),
    cost: z
      .object({ currency: z.string(), amount: z.number() })
      .optional()
      .describe(
        "What the attempt cost, when the evaluator spent money before declining to score",
      ),
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
 * A refusal from the evaluate family.
 *
 * `error` is the sentence, which is this endpoint's long-standing wire shape.
 * A missing required field additionally carries `kind` — the stable
 * `HandledError` code, named `kind` for back-compat — and `meta` naming the
 * field, so a client can say which input was missing without matching prose.
 */
export const evaluateErrorSchema = z.object({
  error: z.string().describe("The failure, as a sentence"),
  kind: z
    .string()
    .optional()
    .describe("Stable failure code, on the failures that carry one"),
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
  isGuardrail: z
    .boolean()
    .describe("Whether this evaluator can gate a request as a guardrail"),
  requiredFields: z
    .array(z.string())
    .describe("`data` keys the evaluate call must supply"),
  optionalFields: z.array(z.string()),
  settings: z
    .record(z.string(), z.unknown())
    .describe("Each setting's default and description"),
  settings_json_schema: z
    .record(z.string(), z.unknown())
    .describe("JSON Schema for this evaluator's settings object"),
  envVars: z
    .array(z.string())
    .describe("Server-side variables the evaluator needs configured"),
  result: z
    .record(z.string(), z.unknown())
    .describe("What its score, passed and label mean"),
});

export const evaluatorCatalogueResponseSchema = z.object({
  evaluators: z
    .record(z.string(), evaluatorSettingsSchema)
    .describe("Keyed by evaluator id, the value you put in the evaluate path"),
});

/**
 * The body `POST /api/dataset/evaluate` parses.
 *
 * Written here rather than reused from the handler's own schema because that
 * one is declared below the route it serves; documenting it at the route means
 * naming it where a reader of the reference will look for it.
 */
export const datasetEvaluateRequestSchema = z.object({
  evaluation: z
    .string()
    .describe(
      "Which evaluator to run, addressed the same way the evaluate endpoints address it",
    ),
  datasetSlug: z.string().describe("The saved dataset to evaluate"),
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
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .nullable()
    .describe("Extra fields merged into every row before evaluating"),
  settings: z
    .record(z.string(), z.unknown())
    .optional()
    .nullable()
    .describe("Per-call overrides of the evaluator's settings"),
});
