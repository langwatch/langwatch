import { z } from "zod";

/**
 * Single source of truth for limit types.
 * Adding a new type here will cause compile errors in all switch statements
 * that use `assertNever`, ensuring exhaustive handling.
 *
 * Seats (members, lite members) are enforced on every plan that sets them.
 * Scenarios, simulations (distinct scenario sets) and custom evaluators are
 * capped on the cloud Free plan only: the plan carries the cap, and every
 * other plan, self-hosted included, leaves it unset and stays uncapped.
 * Everything else (projects, teams, prompts, workflows, datasets, ...) has
 * no creation cap on any plan.
 */
export const limitTypes = [
  "members",
  "membersLite",
  "scenarios",
  "scenarioSets",
  "evaluators",
] as const;

export type LimitType = (typeof limitTypes)[number];

/** Zod schema derived from the same source of truth */
export const limitTypeSchema = z.enum(limitTypes);

/** Result of checking a limit */
export interface LimitCheckResult {
  /** Whether the organization can create another resource of this type */
  readonly allowed: boolean;
  /** Current count of resources */
  readonly current: number;
  /** Maximum allowed by current plan */
  readonly max: number;
  /** Type of limit being checked */
  readonly limitType: LimitType;
}
