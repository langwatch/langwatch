import type { CodingAgentSessionBranchRecord } from "@langwatch/coding-agent-contract";

/**
 * One stamped amount, from either record: where it was spent, and how much.
 * `SessionModelTotalsRow` and the row's own per-context usage share this shape.
 */
export interface StampedUsage {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

const COUNTER_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
] as const;

type Counter = (typeof COUNTER_FIELDS)[number];

/** What a bucket's record holds of each counter and of the cost. */
export type BucketAmounts = Pick<StampedUsage, Counter | "costUsd">;

/** Each bucket's summed record, the cost never negative (see `costOf`). */
export function bucketAmountsOf({
  ledger,
  keyOf,
}: {
  ledger: readonly StampedUsage[];
  keyOf: (usage: StampedUsage) => string;
}): Map<string, BucketAmounts> {
  const amounts = new Map<string, BucketAmounts>();
  for (const usage of ledger) {
    const key = keyOf(usage);
    const current = amounts.get(key);
    amounts.set(key, {
      inputTokens: (current?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (current?.outputTokens ?? 0) + usage.outputTokens,
      cacheReadTokens: (current?.cacheReadTokens ?? 0) + usage.cacheReadTokens,
      cacheCreationTokens: (current?.cacheCreationTokens ?? 0) + usage.cacheCreationTokens,
      costUsd: (current?.costUsd ?? 0) + costOf(usage),
    });
  }

  return amounts;
}

/**
 * What one amount splits by: the record's own figure for it where the record holds any, else
 * the bucket weights. Work recorded at two rates thus keeps what each bucket recorded.
 */
function ratioFor({
  field,
  amounts,
  buckets,
  totalWeight,
}: {
  field: Counter | "costUsd";
  amounts: ReadonlyMap<string, BucketAmounts>;
  buckets: ReadonlyMap<string, number>;
  totalWeight: number;
}): { weightOf: (key: string) => number; total: number } {
  const total = [...amounts.values()].reduce((sum, amount) => sum + amount[field], 0);
  if (total > 0) {
    return { weightOf: (key) => amounts.get(key)?.[field] ?? 0, total };
  }

  return { weightOf: (key) => buckets.get(key) ?? 0, total: totalWeight };
}

/** This pull request's share of the session's cost, never rounded: it is a currency amount. */
export function allocateCost({
  costUsd,
  buckets,
  amounts,
  totalWeight,
  ownKeys,
}: {
  costUsd: number;
  buckets: ReadonlyMap<string, number>;
  amounts: ReadonlyMap<string, BucketAmounts>;
  totalWeight: number;
  ownKeys: readonly string[];
}): number {
  const ratio = ratioFor({ field: "costUsd", amounts, buckets, totalWeight });
  const owned = ownKeys.reduce((total, key) => total + ratio.weightOf(key), 0);
  return (costUsd * owned) / ratio.total;
}

/**
 * This pull request's whole-token share of each of the session's counters.
 */
export function allocateCounters({
  session,
  buckets,
  amounts,
  totalWeight,
  ownKeys,
}: {
  session: CodingAgentSessionBranchRecord;
  buckets: ReadonlyMap<string, number>;
  amounts: ReadonlyMap<string, BucketAmounts>;
  totalWeight: number;
  ownKeys: readonly string[];
}): Pick<CodingAgentSessionBranchRecord, Counter> {
  // Sorted so the allocation never depends on the order rows arrived in.
  const keys = [...buckets.keys()].toSorted();
  const owned = new Set(ownKeys);
  const allocated = {} as Record<Counter, number>;

  for (const field of COUNTER_FIELDS) {
    const amount = Math.max(0, Math.floor(session[field]));
    const ratio = ratioFor({ field, amounts, buckets, totalWeight });
    const floors = new Map<string, number>();
    const remainders: { key: string; remainder: number }[] = [];
    let handedOut = 0;

    for (const key of keys) {
      const exact = (amount * ratio.weightOf(key)) / ratio.total;
      const whole = Math.floor(exact);
      floors.set(key, whole);
      handedOut += whole;
      remainders.push({ key, remainder: exact - whole });
    }

    // What rounding down left over goes to the largest remainders first, ties
    // broken by key so two reads of the same session agree.
    remainders.sort((a, b) => b.remainder - a.remainder || (a.key < b.key ? -1 : 1));
    for (const { key } of remainders.slice(0, amount - handedOut)) {
      floors.set(key, floors.get(key)! + 1);
    }

    allocated[field] = keys
      .filter((key) => owned.has(key))
      .reduce((total, key) => total + floors.get(key)!, 0);
  }

  return allocated;
}

/**
 * An amount from before its session declared a working context. Stamps are
 * written all-or-nothing, so any missing field means the whole stamp is
 * absent.
 */
export function isUnstamped(usage: StampedUsage): boolean {
  return usage.repositoryOwner === "" || usage.repositoryName === "" || usage.branch === "";
}

/**
 * Case-folded like every repository comparison on this path: a stamp carries
 * the remote's casing verbatim, the mapping stores lower case. Branch names
 * stay case sensitive and are compared by the caller.
 */
export function isStampedOnRepository({
  usage,
  repositoryHost,
  repositoryFullName,
}: {
  usage: StampedUsage;
  repositoryHost: string;
  repositoryFullName: string;
}): boolean {
  if (isUnstamped(usage)) {
    return false;
  }

  return (
    usage.repositoryHost.toLowerCase() === repositoryHost.toLowerCase() &&
    `${usage.repositoryOwner}/${usage.repositoryName}`.toLowerCase() ===
      repositoryFullName.toLowerCase()
  );
}

/**
 * The unit one session's record is weighed in, and its total in that unit.
 */
export function weighing(entries: readonly StampedUsage[]): {
  weightOf: (usage: StampedUsage) => number;
  totalWeight: number;
} {
  const tokenWeight = sum(entries, tokensOf);
  if (tokenWeight > 0) {
    return { weightOf: tokensOf, totalWeight: tokenWeight };
  }

  return {
    weightOf: costOf,
    totalWeight: sum(entries, costOf),
  };
}

export function tokensOf(usage: StampedUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

/** Never negative: a stray negative cost would eat another entry's share. */
export function costOf(usage: StampedUsage): number {
  return usage.costUsd > 0 ? usage.costUsd : 0;
}

function sum(entries: readonly StampedUsage[], of: (usage: StampedUsage) => number): number {
  return entries.reduce((total, usage) => total + of(usage), 0);
}
