/**
 * What a scenario run records of its setup and teardown hooks (ADR-180).
 * @see dev/docs/adr/180-scenario-run-hooks.md
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A hook's default budget, when the scenario sets none. */
const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

/**
 * How long a hook may take (milliseconds): the budget the run declared, or the owner's default
 * when it declared none. The owner decides the number, so a caller asks for the budget and keeps
 * no copy of it.
 */
export function hookTimeoutMsFor({ declared }: { declared: number | undefined }): number {
  return declared ?? DEFAULT_HOOK_TIMEOUT_MS;
}

/**
 * How one hook ended. `skipped` is on purpose (the run kept its data); `not_run` is an accident,
 * such as the agent being offline when teardown was due.
 */
export const SCENARIO_HOOK_STATUSES = ["ok", "failed", "timed_out", "skipped", "not_run"] as const;
export type ScenarioHookStatus = (typeof SCENARIO_HOOK_STATUSES)[number];

const hookObjectSchema = z.record(z.string(), z.unknown());

const scenarioHookResultSchemaDefinition = z.object({
  status: z.enum(SCENARIO_HOOK_STATUSES),
  durationMs: z.number().nonnegative(),
  /** The trace the hook call ran under, when one was active. */
  traceId: z.string().optional(),
  /** Setup's state, or the state teardown was given. */
  state: hookObjectSchema.optional(),
  /** What teardown returned. */
  returned: hookObjectSchema.optional(),
  /** The state or the returned object was over the cap, so the record keeps no copy of it. */
  stateTooLarge: z.boolean().optional(),
  returnedTooLarge: z.boolean().optional(),
  error: z.string().optional(),
});
export interface ScenarioHookResultSchema extends Named<
  typeof scenarioHookResultSchemaDefinition
> {}
export const scenarioHookResultSchema: ScenarioHookResultSchema =
  scenarioHookResultSchemaDefinition;
export type ScenarioHookResult = z.infer<typeof scenarioHookResultSchema>;

/** The hooks a run called; a hook the agent did not declare is absent. */
const scenarioRunHooksSchemaDefinition = z.object({
  setup: scenarioHookResultSchema.optional(),
  teardown: scenarioHookResultSchema.optional(),
});
export interface ScenarioRunHooksSchema extends Named<typeof scenarioRunHooksSchemaDefinition> {}
export const scenarioRunHooksSchema: ScenarioRunHooksSchema = scenarioRunHooksSchemaDefinition;
export type ScenarioRunHooks = z.infer<typeof scenarioRunHooksSchema>;

/**
 * A run whose setup did not answer (failed, timed out, or its agent was offline) is not scored:
 * it has no verdict and no pass rate counts it. Teardown never changes the score.
 */
export function isRunNotScored(hooks: ScenarioRunHooks | null | undefined): boolean {
  const setup = hooks?.setup;
  return setup !== undefined && setup.status !== "ok";
}
