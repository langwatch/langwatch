/** Evaluator result shape; kept dependency-free to break import cycle with
 * event-schemas and scenario-run.
 */
import { z } from "zod";

/** Evaluation statuses: passed/failed (pass/fail evaluators), scored, skipped,
 * or error.
 */
export const SCENARIO_EVALUATION_STATUSES = [
  "passed",
  "failed",
  "scored",
  "skipped",
  "error",
] as const;
export type ScenarioEvaluationStatus =
  (typeof SCENARIO_EVALUATION_STATUSES)[number];

/** Wire shape for `results.evaluations` on finished event; required evaluators
 * with failed/error status fail the run.
 */
export const scenarioEvaluationResultSchema = z
  .object({
    /**
     * The saved evaluator id, or the evaluator type (for example
     * `ragas/sql_query_equivalence`) when run from code without a saved
     * record.
     */
    evaluatorId: z.string(),
    name: z.string(),
    status: z.enum(SCENARIO_EVALUATION_STATUSES),
    required: z.boolean(),
    passed: z.boolean().optional(),
    score: z.number().optional(),
    label: z.string().optional(),
    /**
     * Why the result is what it is: the judge's explanation, or the reason a
     * check was skipped or failed before it ran ("no golden_sql on this
     * scenario", "no run_sql call in the trace").
     */
    details: z.string().optional(),
    cost: z.object({ currency: z.string(), amount: z.number() }).optional(),
    /** The resolved input values, truncated to 2k characters each, for the UI. */
    inputs: z.record(z.string(), z.string()).optional(),
  })
  .refine((result) => result.status !== "passed" || result.passed === true, {
    message: "A result with status passed needs passed: true",
    path: ["passed"],
  })
  .refine((result) => result.status !== "failed" || result.passed === false, {
    message: "A result with status failed needs passed: false",
    path: ["passed"],
  });
export type ScenarioEvaluationResult = z.infer<
  typeof scenarioEvaluationResultSchema
>;
