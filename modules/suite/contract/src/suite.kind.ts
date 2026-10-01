import { z } from "zod";

/**
 * The kinds of SimulationSuite: "run_plan" is hand-assembled, "test_suite"
 * groups scenarios via `Scenario.testSuiteId`. A string column plus this
 * union, not a Prisma enum — adding a kind must not need a migration.
 */
export const SUITE_KINDS = ["test_suite", "run_plan"] as const;
export const suiteKindSchema = z.enum(SUITE_KINDS);
export type SuiteKind = z.infer<typeof suiteKindSchema>;

export function isSuiteKind(value: string): value is SuiteKind {
  return suiteKindSchema.validate(value);
}
