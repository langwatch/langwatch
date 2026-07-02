import { z } from "zod";

/**
 * Single source of truth for limit types.
 * Adding a new type here will cause compile errors in all switch statements
 * that use `assertNever`, ensuring exhaustive handling.
 *
 * Only the seat levers remain enforced: members and lite members. Workspace
 * structure (projects, teams) and all experimentation resources (workflows,
 * prompts, evaluators, scenarios, agents, experiments, online evaluations,
 * datasets, dashboards, custom graphs, automations) are OSS (Apache 2.0) and
 * have no creation cap on any plan — cloud monetizes via traces/messages
 * volume and seats, not by counting workspaces or experimentation artifacts.
 */
export const limitTypes = [
  "members",
  "membersLite",
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
