import { z } from "zod";

/** What a query string may say for yes and for no. Compared case-folded. */
const QUERY_BOOLEAN_TRUE = ["true", "1", "yes"];
const QUERY_BOOLEAN_FALSE = ["false", "0", "no", ""];

/**
 * A boolean spelled in a query string.
 */
export const queryBoolean = z
  .string()
  .optional()
  .default("false")
  .transform((raw, ctx): boolean | typeof z.NEVER => {
    const spelling = raw.toLowerCase();
    if (QUERY_BOOLEAN_TRUE.includes(spelling)) return true;
    if (QUERY_BOOLEAN_FALSE.includes(spelling)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `must be one of ${[...QUERY_BOOLEAN_TRUE, ...QUERY_BOOLEAN_FALSE.filter(Boolean)].join(", ")}`,
    });
    return z.NEVER;
  })
  .describe(
    `${QUERY_BOOLEAN_TRUE.join(", ")} for yes; ${QUERY_BOOLEAN_FALSE.filter(Boolean).join(", ")} or omitted for no.`,
  );

/** The run plan a `/run-plans/:id` route addresses. */
export const runPlanIdParamsSchema = z.object({
  id: z.string().min(1).describe("The run plan id."),
});

export const runPlanListQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived run plans in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

export const runPlanArchiveResultSchema = z.object({
  id: z.string().describe("The run plan that was archived."),
  archived: z.literal(true).describe("Always true once the plan is archived."),
});

/** The test suite a `/test-suites/:id` route addresses. */
export const testSuiteIdParamsSchema = z.object({
  id: z.string().min(1).describe("The test suite id."),
});

export const testSuiteListQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived test suites in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

export const testSuiteArchiveResultSchema = z.object({
  id: z.string().describe("The test suite that was archived."),
  archived: z.literal(true).describe("Always true once the suite is archived."),
});
