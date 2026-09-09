import { z } from "zod";

/**
 * The kinds of SimulationSuite.
 *
 * "run_plan" is a hand-assembled plan; "test_suite" is a suite that groups
 * scenarios through Scenario.testSuiteId. A string column plus this union, not
 * a Prisma enum: adding a kind must not need a database migration.
 */
export const SUITE_KINDS = ["test_suite", "run_plan"] as const;
export const suiteKindSchema = z.enum(SUITE_KINDS);
export type SuiteKind = z.infer<typeof suiteKindSchema>;

export function isSuiteKind(value: string): value is SuiteKind {
  return suiteKindSchema.safeParse(value).success;
}
