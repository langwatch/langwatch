/**
 * Domain types for simulation suite configurations.
 *
 * These types represent core business concepts and are used by
 * both the service layer and API layer.
 */

import { z } from "zod";

/** Target reference in a suite configuration */
export const suiteTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

export type SuiteTarget = z.infer<typeof suiteTargetSchema>;

/** Agent target types — every suite target type except "prompt". Must stay in sync with suiteTargetSchema. */
export const SUITE_AGENT_TARGET_TYPES = ["http", "code", "workflow"] as const;
export type SuiteAgentTargetType = (typeof SUITE_AGENT_TARGET_TYPES)[number];

/** Type guard: narrows `type` to `SuiteAgentTargetType`. */
export function isSuiteAgentTargetType(type: string): type is SuiteAgentTargetType {
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
