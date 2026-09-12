/**
 * One evaluator result on a scenario run, and the statuses it can hold.
 *
 * Framework-free on purpose: `simulation.ts` (the run's own result shape) and
 * `schemas/event-schemas.ts` (the finished event's wire shape) both depend on
 * this leaf, and `event-schemas.ts` itself sits in a cycle back through
 * `scenario-run.ts` to `simulation.ts` — a schema declared inside that cycle
 * throws `Cannot read properties of undefined` at import time for whichever
 * side loads second. Keeping this shape dependency-free breaks the cycle.
 *
 * @see specs/scenarios/scenario-run-evaluations.feature
 */
import { z } from "zod";

/**
 * The statuses one evaluator result can hold on a scenario run.
 *
 * - `passed` / `failed`: a pass/fail evaluator decided.
 * - `scored`: a score-only evaluator reported a number and no pass.
 * - `skipped`: the evaluator did not run, `details` says why (for example a
 *   blank field on the scenario).
 * - `error`: the evaluator ran and failed to produce a result.
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

/**
 * One evaluator result on a scenario run.
 *
 * This is the wire shape of `results.evaluations` on the finished event and
 * on every read of a run. The scenario framework (Python and TypeScript)
 * mirrors this schema field for field, so a scenario run from code sends its
 * evaluations in exactly this shape and the platform stores them as sent.
 *
 * A `required` evaluator with the status `failed` or `error` fails the run.
 * Scores and skipped results never change the verdict.
 *
 * @see specs/scenarios/scenario-run-evaluations.feature
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
