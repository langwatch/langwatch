/**
 * What a run plan covers.
 *
 * One zod union is the only definition of the shape: the database column, the
 * tRPC input, the REST body and the form all read it from here, so a mode
 * cannot be added on one side and missed on another.
 *
 * A plan stored before scopes carries null, which reads as
 * {@link SCENARIOS_SCOPE} and runs the `scenarioIds` it already held. A
 * `kind: "test_suite"` suite carries no scope at all: its members come from
 * `Scenario.testSuiteId`.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */

import { z } from "zod";

export const SUITE_SCOPE_MODES = [
  "all",
  "test_suites",
  "labels",
  "scenarios",
] as const;
export type SuiteScopeMode = (typeof SUITE_SCOPE_MODES)[number];

export const suiteScopeSchema = z.discriminatedUnion("mode", [
  /** Every non-archived scenario of the project. */
  z.object({ mode: z.literal("all") }),
  /** The non-archived scenarios filed in any of these test suites. */
  z.object({
    mode: z.literal("test_suites"),
    testSuiteIds: z.array(z.string()),
  }),
  /** The non-archived scenarios carrying at least one of these labels. */
  z.object({ mode: z.literal("labels"), labels: z.array(z.string()) }),
  /** The stored `scenarioIds`, picked by hand. */
  z.object({ mode: z.literal("scenarios") }),
]);

export type SuiteScope = z.infer<typeof suiteScopeSchema>;

/** What a plan with no stored scope covers. */
export const SCENARIOS_SCOPE: SuiteScope = { mode: "scenarios" };

/**
 * Reads a stored scope value. Null, and anything the union refuses, read as
 * the hand-picked list: a row written before scopes existed carries null, and
 * a row whose value cannot be understood must still run rather than refuse.
 */
export function parseSuiteScope(raw: unknown): SuiteScope {
  if (raw === null || raw === undefined) return SCENARIOS_SCOPE;
  const parsed = suiteScopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : SCENARIOS_SCOPE;
}

/** True when the scope is resolved against the project at run time. */
export function isDynamicScope(scope: SuiteScope): boolean {
  return scope.mode !== "scenarios";
}
