/**
 * Domain types for simulation suite configurations.
 *
 * These types represent core business concepts and are used by
 * both the service layer and API layer.
 */

import { z } from "zod";
import { FieldMappingSchema } from "../scenarios/field-mapping";
import {
  MAX_PARAMETER_NAME_LENGTH,
  MAX_RUN_PARAMETER_KEYS,
  runParameterValuesSchema,
} from "../scenarios/parameters";

/**
 * The kinds of SimulationSuite.
 *
 * "run_plan" is a hand-assembled plan; "test_suite" is a suite that groups
 * scenarios through Scenario.testSuiteId. A string column plus this const
 * union, not a Prisma enum: adding a kind must not need a database migration.
 */
export const SUITE_KINDS = ["test_suite", "run_plan"] as const;
export type SuiteKind = (typeof SUITE_KINDS)[number];

/** Type guard: narrows a stored string to SuiteKind. */
export function isSuiteKind(value: string): value is SuiteKind {
  return (SUITE_KINDS as readonly string[]).includes(value);
}

const suiteTargetFields = z.object({
  type: z.enum(["prompt", "http", "code", "workflow", "connected"]),
  /**
   * The id of the prompt or agent. A connected target may also say
   * `<name>@<environment>`, which the run resolves to the agent id before
   * anything is scheduled (see `resolveConnectedTargetReferences`).
   */
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
  /**
   * The parameter overrides this target runs with, merged over the values
   * supplied for the run as a whole. The target's values win.
   *
   * They are part of the target's identity: one agent may appear twice in a
   * run with different overrides, and each is its own target with its own
   * key and its own column. See `target-key.ts`.
   *
   * Secret parameters are never kept here: their values are typed once per
   * run and travel with the run alone. A target naming one is refused.
   */
  runParameters: runParameterValuesSchema.optional(),
  /**
   * The names of the parameters the last run marked secret.
   *
   * The value of a secret is never written down. The name is, so the next run
   * dialog shows the row again with an empty field and asks for the value
   * instead of losing the row.
   */
  runSecretParameterNames: z
    .array(z.string().max(MAX_PARAMETER_NAME_LENGTH))
    .max(MAX_RUN_PARAMETER_KEYS)
    .optional(),
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
export const SUITE_AGENT_TARGET_TYPES = [
  "http",
  "code",
  "workflow",
  "connected",
] as const;
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
