import { z } from "zod";

/**
 * Typed inputs for the run plan tools, mirroring the platform's REST
 * validation (`suiteScopeSchema` and `suiteTargetSchema`) so an agent
 * learns what's accepted before the request goes out.
 */

/** What a run plan covers. */
export const runPlanScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }).describe("Every non-archived scenario of the project"),
  z
    .object({
      mode: z.literal("test_suites"),
      testSuiteIds: z.array(z.string()).describe("The test suite IDs whose scenarios to run"),
    })
    .describe("The non-archived scenarios filed in the given test suites"),
  z
    .object({
      mode: z.literal("labels"),
      labels: z.array(z.string()).describe("The labels to select scenarios by"),
    })
    .describe("The non-archived scenarios carrying at least one of the given labels"),
  z
    .object({ mode: z.literal("scenarios") })
    .describe("The scenarios named in scenarioIds, picked by hand"),
]);

/** The values a run supplies for the parameters its scenarios declare. */
export const runParametersSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

/**
 * One thing a plan runs its scenarios against, and the values it alone
 * runs with. Parameters make a comparison run: two targets may name the
 * same agent with different values, each run and reported on its own.
 */
export const runPlanTargetSchema = z.object({
  type: z
    .enum(["connected", "prompt", "http", "code", "workflow"])
    .describe(
      "What kind of thing the target is. A connected agent is one that registered itself from code with connectAgent (TypeScript) or connect_agent (Python).",
    ),
  referenceId: z
    .string()
    .describe(
      "The ID of the prompt, agent or workflow to run against. A connected agent may also be named as <name>@<environment>, for example support-agent@production; the platform resolves it.",
    ),
  parameters: runParametersSchema
    .optional()
    .describe(
      "Parameter values this target alone runs with, by name. They override the run-level parameters for this target. Name the same agent twice with different values here to compare it on two models.",
    ),
});

/**
 * One target as `/api/v1` carries it. Tool input spells per-target
 * values `parameters`, beside run-level `parameters`; the REST body
 * spells them `runParameters` since a target holds the values it runs with.
 */
export interface RunPlanTargetWire {
  type: z.infer<typeof runPlanTargetSchema>["type"];
  referenceId: string;
  runParameters?: z.infer<typeof runParametersSchema>;
}

/** The targets of a tool call, as the REST body carries them. */
export function toWireTargets(targets: z.infer<typeof runPlanTargetSchema>[]): RunPlanTargetWire[] {
  return targets.map((target) => ({
    type: target.type,
    referenceId: target.referenceId,
    ...(target.parameters ? { runParameters: target.parameters } : {}),
  }));
}
