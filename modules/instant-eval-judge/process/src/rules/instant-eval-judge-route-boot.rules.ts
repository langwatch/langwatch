/**
 * What stops a configured route table from booting: a backend it can reach with no price, no
 * key on this install, or no model. Checked once at boot, so a deploy mistake fails fast
 * instead of billing a leg at zero or skipping every escalation.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

import {
  INSTANT_EVAL_JUDGE_JOBS,
  INSTANT_EVAL_JUDGE_MODES,
  instantEvalJudgeEntryBackends,
  type InstantEvalJudgeBackendKind,
  type InstantEvalJudgeRouteEntry,
  type InstantEvalJudgeRoutePricing,
  type InstantEvalJudgeRouteTable,
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

/** Every enabled backend a usable entry may call, with its enabled fallbacks. */
function reachableBackendsOf(table: InstantEvalJudgeRouteTable): Set<string> {
  const reachable = new Set<string>();
  const entries = INSTANT_EVAL_JUDGE_JOBS.flatMap((job) =>
    Object.values(table.routes[job]).flatMap((slot) =>
      INSTANT_EVAL_JUDGE_MODES.flatMap((mode) => slot[mode] ?? []),
    ),
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
  const isEnabled = (name: string) => table.backends[name]?.enabled === true;
  const backends = instantEvalJudgeEntryBackends(entry);
  if (!backends.every(isEnabled)) return [];
  const fallbacks = backends.flatMap((name) => table.backends[name]?.fallbacks ?? []);
  return [...backends, ...fallbacks.filter(isEnabled)];
}
