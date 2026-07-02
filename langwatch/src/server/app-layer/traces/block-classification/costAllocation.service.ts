/**
 * Cache-aware exact-token cost allocation (ADR-033 Decision 2).
 *
 * Provider-reported usage is ground truth and is never overridden. Input blocks
 * are assigned to three tiers by prefix position: the cached prefix (up to the
 * last cache_control breakpoint) fills the cache-read pool first, then overflows
 * into cache-creation (this is the turn-1 case — cache_read = 0, whole prefix at
 * the cache-creation rate); blocks after the breakpoint fill the fresh-input
 * pool. Output blocks fill the output pool.
 *
 * Within each pool, block tokens are scaled so the per-category tokens sum
 * EXACTLY to that pool's provider total (Decision 2.4), which makes Σ per-category
 * cost ≡ the span's real cost — the conservation invariant. Zero-guard: a nonzero
 * pool with no blocks lands its whole total in the axis catch-all, never dropped,
 * never divided by zero.
 *
 * Pure and deterministic — no clock, no randomness, no I/O.
 */

import { type Category, catchAllFor } from "./categories";

export type CacheTier = "fresh" | "cache_read" | "cache_creation";

/** A classified block with its (caller-supplied) token estimate. */
export interface TokenBlock {
  category: Category;
  tokens: number;
}

/** Provider-reported usage pools — the ground truth totals per tier. */
export interface UsagePools {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}

/** Per-tier prices; a missing rate prices that tier at 0 (tokens still allocated). */
export interface TierPrices {
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
}

export interface CategoryTotal {
  tokens: number;
  costUsd: number;
}

export type CategoryTotals = Partial<Record<Category, CategoryTotal>>;

interface Pool {
  total: number;
  rate: number;
  axis: "input" | "output";
  blocks: TokenBlock[];
}

/**
 * Allocate a span's provider-reported usage across its content-block categories,
 * cache-tier aware. Returns per-category `{ tokens, costUsd }` whose costs sum to
 * the span's real cost within float rounding.
 *
 * @param lastCacheBreakpointIndex index (into `inputBlocks`) of the last
 *   cache_control breakpoint — the cached prefix is blocks `0..index`. `null`
 *   means no effective breakpoint, so all input is fresh; any reported
 *   cache pool with no blocks then degrades to the catch-all (zero-guard).
 */
export function allocateCategoryCosts({
  inputBlocks,
  outputBlocks,
  lastCacheBreakpointIndex,
  pools,
  prices,
}: {
  inputBlocks: TokenBlock[];
  outputBlocks: TokenBlock[];
  lastCacheBreakpointIndex: number | null;
  pools: UsagePools;
  prices: TierPrices;
}): { categoryTotals: CategoryTotals } {
  const { cachePrefix, fresh } = partitionInput({
    inputBlocks,
    lastCacheBreakpointIndex,
    cacheReadTokens: pools.cacheReadTokens,
    cacheCreationTokens: pools.cacheCreationTokens,
  });

  const poolList: Pool[] = [
    {
      total: pools.cacheReadTokens,
      rate: prices.cacheReadCostPerToken ?? 0,
      axis: "input",
      blocks: cachePrefix.cacheRead,
    },
    {
      total: pools.cacheCreationTokens,
      rate: prices.cacheCreationCostPerToken ?? 0,
      axis: "input",
      blocks: cachePrefix.cacheCreation,
    },
    {
      total: pools.inputTokens,
      rate: prices.inputCostPerToken ?? 0,
      axis: "input",
      blocks: fresh,
    },
    {
      total: pools.outputTokens,
      rate: prices.outputCostPerToken ?? 0,
      axis: "output",
      blocks: outputBlocks,
    },
  ];

  const totals: CategoryTotals = {};
  for (const pool of poolList) allocatePool(pool, totals);
  return { categoryTotals: totals };
}

/**
 * Split input blocks into the cached prefix (cache_read then cache_creation) and
 * the fresh remainder. Blocks are assigned whole — the prefix fills the
 * cache_read pool by cumulative token estimate, then the rest of the prefix
 * overflows to cache_creation. When neither cache pool has capacity, the
 * breakpoint is irrelevant and everything is fresh.
 */
function partitionInput({
  inputBlocks,
  lastCacheBreakpointIndex,
  cacheReadTokens,
  cacheCreationTokens,
}: {
  inputBlocks: TokenBlock[];
  lastCacheBreakpointIndex: number | null;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): {
  cachePrefix: { cacheRead: TokenBlock[]; cacheCreation: TokenBlock[] };
  fresh: TokenBlock[];
} {
  const cacheRead: TokenBlock[] = [];
  const cacheCreation: TokenBlock[] = [];

  const hasCache = cacheReadTokens > 0 || cacheCreationTokens > 0;
  if (lastCacheBreakpointIndex === null || !hasCache) {
    return { cachePrefix: { cacheRead, cacheCreation }, fresh: inputBlocks };
  }

  const prefixEnd = Math.min(lastCacheBreakpointIndex + 1, inputBlocks.length);
  const prefix = inputBlocks.slice(0, prefixEnd);
  const fresh = inputBlocks.slice(prefixEnd);

  let running = 0;
  for (const block of prefix) {
    if (running < cacheReadTokens) cacheRead.push(block);
    else cacheCreation.push(block);
    running += block.tokens;
  }

  return { cachePrefix: { cacheRead, cacheCreation }, fresh };
}

/**
 * Scale a pool's block tokens so they sum EXACTLY to the pool total, add them to
 * the running category totals, and price them. The last block absorbs the
 * residual so the pool sums exactly regardless of float drift. A nonzero pool
 * with no blocks (zero-guard) drops its whole total into the axis catch-all.
 */
function allocatePool(pool: Pool, totals: CategoryTotals): void {
  if (pool.total <= 0) return;

  if (pool.blocks.length === 0) {
    addTokens({
      totals,
      category: catchAllFor(pool.axis),
      tokens: pool.total,
      rate: pool.rate,
    });
    return;
  }

  const sum = pool.blocks.reduce((acc, b) => acc + b.tokens, 0);

  // Degenerate: blocks present but no token mass (truncated/reconstructed
  // content) — the whole total is unattributable, so it lands in the catch-all.
  if (sum <= 0) {
    addTokens({
      totals,
      category: catchAllFor(pool.axis),
      tokens: pool.total,
      rate: pool.rate,
    });
    return;
  }

  let allocated = 0;
  for (let i = 0; i < pool.blocks.length; i++) {
    const block = pool.blocks[i]!;
    const scaled =
      i === pool.blocks.length - 1
        ? pool.total - allocated
        : (block.tokens * pool.total) / sum;
    allocated += scaled;
    addTokens({ totals, category: block.category, tokens: scaled, rate: pool.rate });
  }
}

function addTokens({
  totals,
  category,
  tokens,
  rate,
}: {
  totals: CategoryTotals;
  category: Category;
  tokens: number;
  rate: number;
}): void {
  const existing = totals[category] ?? { tokens: 0, costUsd: 0 };
  existing.tokens += tokens;
  existing.costUsd += tokens * rate;
  totals[category] = existing;
}
