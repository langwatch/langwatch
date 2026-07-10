import { z } from "zod";
import type { MemberPolicy } from "../../../ee/licensing/planInfo";

/**
 * How a denied action can be resolved (ADR-039 Decision 5). Mirrors the plan's
 * memberPolicy for member limits; every other limit type resolves "upgrade".
 * The UI routes on this: purchase_seat → seat proration modal, upgrade → plan
 * management, hard_cap → contact us. On the public API it is advisory
 * metadata in the 403 body.
 */
export type LimitResolution = MemberPolicy;

/**
 * Single source of truth for limit types.
 * Adding a new type here will cause compile errors in all switch statements
 * that use `assertNever`, ensuring exhaustive handling.
 */
export const limitTypes = [
  "workflows",
  "prompts",
  "evaluators",
  "scenarios",
  "projects",
  "teams",
  "members",
  "membersLite",
  "agents",
  "experiments",
  "onlineEvaluations",
  "datasets",
  "dashboards",
  "customGraphs",
  "automations",
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
  /** How the caller can resolve a denial (ADR-039 Decision 5) */
  readonly resolution: LimitResolution;
}
