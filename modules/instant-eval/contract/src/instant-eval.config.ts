import { Config, type ConfigOf, isSaas, nodeEnvironment } from "@langwatch/config";
import { z } from "zod";

/**
 * Which judge a deployment judges with and what a run may spend. The cloud classifier's key,
 * origin, model and rates belong to the Instant Evals judge (ADR-174 decision 13).
 */
export const instantEvalConfig = Config.define((c) => ({
  /** "jev", "connect" or "null" (judging off); "memory" is a stand-in refused in production. */
  classifier: c.env(
    "INSTANT_EVAL_CLASSIFIER",
    z.enum(["jev", "null", "connect", "memory"]).optional(),
  ),
  /**
   * Whether this deployment bills Instant Evals, which is what makes the free
   * allowance a ceiling. An installation that does not bill bounds a run by
   * its row cap alone. Unset follows `isSaas`: see `isInstantEvalBounded`.
   */
  isBounded: c.env("INSTANT_EVAL_BOUNDED", z.stringbool().optional()),
  /** Input tokens one synchronous query may send. */
  queryTokenBudget: c.env(
    "INSTANT_EVAL_QUERY_TOKEN_BUDGET",
    z.coerce.number().positive().default(4_000_000),
  ),
  /** The hosted product, which decides whether the opt-in is offered or sent to sales. */
  isSaas,
  /** The shared leaf: "production" refuses the memory judge. */
  nodeEnvironment,
}));

export type InstantEvalServerConfig = ConfigOf<typeof instantEvalConfig>;

/**
 * The hosted product bills, so it bounds the free budget unless told not to;
 * a self-hosted installation bills nothing, so it bounds nothing unless told to.
 */
export function isInstantEvalBounded({
  isBounded,
  isSaas,
}: Pick<InstantEvalServerConfig, "isBounded" | "isSaas">): boolean {
  return isBounded ?? isSaas;
}
