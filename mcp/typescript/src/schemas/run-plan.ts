import { z } from "zod";

/**
 * Typed inputs for the run plan tools.
 *
 * Each one mirrors the zod the platform validates the REST body with, so an
 * agent is told what is accepted before the request goes out rather than
 * after: `suiteScopeSchema` and `suiteTargetSchema` on the server side.
 */

/** What a run plan covers. */
export const runPlanScopeSchema = z.discriminatedUnion("mode", [
  z
    .object({ mode: z.literal("all") })
    .describe("Every non-archived scenario of the project"),
  z
    .object({
      mode: z.literal("test_suites"),
      testSuiteIds: z
        .array(z.string())
        .describe("The test suite IDs whose scenarios to run"),
    })
    .describe("The non-archived scenarios filed in the given test suites"),
  z
    .object({
      mode: z.literal("labels"),
      labels: z.array(z.string()).describe("The labels to select scenarios by"),
    })
    .describe(
      "The non-archived scenarios carrying at least one of the given labels",
    ),
  z
    .object({ mode: z.literal("scenarios") })
    .describe("The scenarios named in scenarioIds, picked by hand"),
]);

/** One thing a plan runs its scenarios against. */
export const runPlanTargetSchema = z.object({
  type: z
    .enum(["prompt", "http", "code", "workflow"])
    .describe("What kind of thing the target is"),
  referenceId: z
    .string()
    .describe("The ID of the prompt, agent or workflow to run against"),
});

/** The values a run supplies for the parameters its scenarios declare. */
export const runParametersSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);
