/**
 * Domain types for simulation suite configurations.
 *
 * These types represent core business concepts and are used by
 * both the service layer and API layer.
 */

import { z } from "zod";
import { FieldMappingSchema } from "../scenarios/execution/types";

const suiteTargetFields = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
  /**
   * Bindings from a scenario source to this target's declared inputs.
   *
   * Only prompt targets carry these. Agents store their own mappings on the
   * agent record, where they belong: an agent is a thing you configure. A
   * prompt is not — it is authored elsewhere and pointed at, so the binding
   * between a simulation and a prompt's inputs lives with the suite that made
   * the pairing. Optional, so suites saved before this field still parse.
   */
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
});

/**
 * Target reference in a suite configuration.
 *
 * ⚠ The refinement is what keeps `scenarioMappings` a prompt-only field: a run
 * reads it from prompt targets and nowhere else, so accepting it on an agent
 * target would persist a binding the run silently ignores.
 */
export const suiteTargetSchema = suiteTargetFields.superRefine(
  (target, ctx) => {
    if (target.type === "prompt" || target.scenarioMappings === undefined) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scenarioMappings"],
      message: `A ${target.type} target cannot carry scenarioMappings — an agent's mappings belong on the agent record.`,
    });
  },
);

export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

/** Agent target types — every suite target type except "prompt". Must stay in sync with suiteTargetSchema. */
export const SUITE_AGENT_TARGET_TYPES = ["http", "code", "workflow"] as const;
export type SuiteAgentTargetType = (typeof SUITE_AGENT_TARGET_TYPES)[number];

/** Type guard: narrows `type` to `SuiteAgentTargetType`. */
export function isSuiteAgentTargetType(
  type: string,
): type is SuiteAgentTargetType {
  return (SUITE_AGENT_TARGET_TYPES as readonly string[]).includes(type);
}

// Compile-time guard: SUITE_AGENT_TARGET_TYPES must stay in sync with suiteTargetSchema (minus "prompt").
type _SchemaAgentTypes = Exclude<SuiteTarget["type"], "prompt">;
type _Assert = SuiteAgentTargetType extends _SchemaAgentTypes
  ? _SchemaAgentTypes extends SuiteAgentTargetType
    ? true
    : never
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _suiteAgentTargetTypesDriftCheck: _Assert = true;

/** Parse and validate suite targets from Prisma's Json field */
export function parseSuiteTargets(raw: unknown): SuiteTarget[] {
  return z.array(suiteTargetSchema).parse(raw);
}
