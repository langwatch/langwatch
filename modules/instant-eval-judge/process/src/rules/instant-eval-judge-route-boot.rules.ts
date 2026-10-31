/**
 * What stops a configured route table from booting: a backend it can reach with no price, no
 * key on this install, or no model. Checked once at boot, so a deploy mistake fails fast
 * instead of billing a leg at zero or skipping every escalation.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  INSTANT_EVAL_JUDGE_MODES,
  INSTANT_EVAL_PRICING,
  instantEvalJudgeEnabledFallbacksOf,
  instantEvalJudgeEntryBackends,
  instantEvalJudgeRouteSlotsOf,
  isInstantEvalJudgeEntryEnabled,
  type InstantEvalJudgeBackendKind,
  type InstantEvalJudgeRouteEntry,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
  type InstantEvalPricing,
} from "@langwatch/instant-eval-judge-contract";

export function instantEvalJudgeRouteBootIssues({
  table,
  pricing,
  isHeld,
}: {
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  /** Whether this install holds a channel and key for a kind; absent, keys are not checked. */
  isHeld?: (kind: InstantEvalJudgeBackendKind) => boolean;
}): string[] {
  const issues: string[] = [];
  for (const name of reachableBackendsOf(table)) {
    const backend = table.backends[name];
    if (!backend) continue;
    if (!pricing.backends[name]) issues.push(`backend ${name}: no price in the route pricing`);
    if (isHeld && !isHeld(backend.kind)) {
      issues.push(`backend ${name}: no ${backend.kind} key or channel on this install`);
    }
  }
  return issues;
}

/**
 * What a judged query's budget hold is priced at: the dearest base input rate of any backend a
 * route can reach, never below the classifier's, at the one markup. A best-effort hold, not a hard
 * cap: it ignores re-sends, output tokens and long-context rates (ADR-190 decision 7).
 */
export function instantEvalJudgeQueryHoldPricingOf({
  table,
  pricing,
  classifierPricing = INSTANT_EVAL_PRICING,
}: {
  table: InstantEvalJudgeRouteTable;
  pricing: InstantEvalJudgeRoutePricing;
  classifierPricing?: InstantEvalPricing;
}): InstantEvalPricing {
  const rates = [...reachableBackendsOf(table)].map(
    (name) => pricing.backends[name]?.usdPerMillionInputTokens ?? 0,
  );
  const usdPerMillionInputTokens = Math.max(classifierPricing.usdPerMillionInputTokens, ...rates);
  return { ...classifierPricing, usdPerMillionInputTokens };
}

/** Every enabled backend a usable entry may call, with its enabled fallbacks. */
function reachableBackendsOf(table: InstantEvalJudgeRouteTable): Set<string> {
  const reachable = new Set<string>();
  // Score and category slots too: an LLM only a score route names must be billable as well.
  const entries = instantEvalJudgeRouteSlotsOf(table).flatMap((slot) =>
    INSTANT_EVAL_JUDGE_MODES.flatMap((mode) => slot[mode] ?? []),
  );
  for (const entry of entries) {
    for (const name of usableEntryBackendsOf({ table, entry })) reachable.add(name);
  }
  return reachable;
}

/** An entry's backends and their enabled fallbacks; none when the entry has one switched off. */
function usableEntryBackendsOf({
  table,
  entry,
}: {
  table: InstantEvalJudgeRouteTable;
  entry: InstantEvalJudgeRouteEntry;
}): string[] {
  if (!isInstantEvalJudgeEntryEnabled({ entry, table })) return [];
  const backends = instantEvalJudgeEntryBackends(entry);
  const fallbacks = backends.flatMap((backend) =>
    instantEvalJudgeEnabledFallbacksOf({ backend, table }),
  );
  return [...backends, ...fallbacks];
}
