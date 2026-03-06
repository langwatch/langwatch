import { z } from "zod";

/**
 * Status values for suite runs.
 */
export const SUITE_RUN_STATUS = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
] as const;
export type SuiteRunStatus = (typeof SUITE_RUN_STATUS)[number];

/**
 * Status values for individual scenario results within a suite run.
 * All terminal states count toward progress.
 */
export const SCENARIO_RESULT_STATUS = [
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
] as const;
export type ScenarioResultStatus = (typeof SCENARIO_RESULT_STATUS)[number];

/**
 * Verdict values for scenario results.
 */
export const SCENARIO_VERDICT = ["success", "failure", "inconclusive"] as const;
export type ScenarioVerdict = (typeof SCENARIO_VERDICT)[number];

/**
 * Schema for target references in suite runs.
 */
export const suiteTargetSchema = z.object({
  id: z.string(),
  type: z.string(),
});
export type SuiteTarget = z.infer<typeof suiteTargetSchema>;
