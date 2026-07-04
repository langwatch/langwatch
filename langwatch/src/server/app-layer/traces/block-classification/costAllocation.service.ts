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
 * Per-tier rates cost the tokens; but when the span carries an authoritative
 * total cost the display trusts OVER the rate estimate — a provider's own billed
 * figure such as Claude Code's `cost_usd` (`computeSpanCost` Priority 2) — the
 * rate-derived Σ would drift from the number the user sees. `reconcileToTotalCost`
 * closes that gap: after pricing, the per-category costs are scaled so their sum
 * equals that authoritative total, keeping conservation against the DISPLAYED
 * cost. When rates priced the span (the normal case) the scale is uniform, so
 * the tier-weighted split is preserved; when NO rate was available at all (an
 * unknown model with only an explicit cost) there is no tier signal to preserve,
 * so the total is distributed by flat token share — accepted degradation on that
 * fully rate-less path, not cache-aware precision (see reconcileCosts).
 *
 * Pure and deterministic — no clock, no randomness, no I/O.
 */

import { type Category, catchAllFor } from "./categories";

export type CacheTier = "fresh" | "cache_read" | "cache_creation";

/** A classified block with its (caller-supplied) token estimate. `idx` is the
 * block's position within its OWN axis (input parts and output parts are counted
 * separately), so it is unique only together with the block's axis — which its
 * `category` already identifies (input and output categories are disjoint sets). */
export interface TokenBlock {
  idx?: number;
  category: Category;
  tokens: number;
}

/** Per-block allocation detail (ADR-033 Schema, `blocks.classification`): the
 * block's post-scale token share and the cache tier it was priced at. Synthetic
 * catch-all tokens (a nonzero pool with no blocks) carry no source block and so
 * are absent here — they surface only in `categoryTotals`.
 *
 * `idx` is axis-local (see TokenBlock): a `blocks` array can hold an input entry
 * and an output entry that share `idx: 0`; disambiguate by the entry's category. */
export interface AllocatedBlock {
  idx: number;
  category: Category;
  tokens: number;
  cacheTier: CacheTier;
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
  tier: CacheTier;
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
 *
 *   CONTRACT: this is used as an array POSITION (`inputBlocks.slice(0, index+1)`),
 *   so `inputBlocks` MUST be the classifier's `input` array 1:1 in emission
 *   order — the position/idx correspondence the classifier guarantees. A caller
 *   that filters or reorders blocks between classification and allocation would
 *   misalign the breakpoint and corrupt the cache-tier split silently (pool
 *   totals stay exact, so conservation would NOT catch it). Do not reshape
 *   `inputBlocks` on the way in.
 */
export function allocateCategoryCosts({
  inputBlocks,
  outputBlocks,
  lastCacheBreakpointIndex,
  inferredCachedPrefixEstTokens = null,
  pools,
  prices,
  reconcileToTotalCost,
}: {
  inputBlocks: TokenBlock[];
  outputBlocks: TokenBlock[];
  lastCacheBreakpointIndex: number | null;
  /** Fractional cached-prefix size (estimate space) from `inferCachedPrefixEstTokens`,
   * used only when `lastCacheBreakpointIndex` is null (no real marker survived). */
  inferredCachedPrefixEstTokens?: number | null;
  pools: UsagePools;
  prices: TierPrices;
  /**
   * An authoritative span-total cost the display trusts over the rate estimate
   * (e.g. Claude Code's `cost_usd`). When set (> 0), the per-category costs are
   * rescaled so Σ equals it, so conservation holds against the DISPLAYED cost.
   * `null`/absent leaves rate-derived costs untouched (the rates already match
   * what the display shows — custom-rate or registry path).
   */
  reconcileToTotalCost?: number | null;
}): { categoryTotals: CategoryTotals; blocks: AllocatedBlock[] } {
  const { cachePrefix, fresh } = partitionInput({
    inputBlocks,
    lastCacheBreakpointIndex,
    inferredCachedPrefixEstTokens,
    cacheReadTokens: pools.cacheReadTokens,
    cacheCreationTokens: pools.cacheCreationTokens,
  });

  const poolList: Pool[] = [
    {
      total: pools.cacheReadTokens,
      rate: prices.cacheReadCostPerToken ?? 0,
      axis: "input",
      tier: "cache_read",
      blocks: cachePrefix.cacheRead,
    },
    {
      total: pools.cacheCreationTokens,
      rate: prices.cacheCreationCostPerToken ?? 0,
      axis: "input",
      tier: "cache_creation",
      blocks: cachePrefix.cacheCreation,
    },
    {
      total: pools.inputTokens,
      rate: prices.inputCostPerToken ?? 0,
      axis: "input",
      tier: "fresh",
      blocks: fresh,
    },
    {
      total: pools.outputTokens,
      rate: prices.outputCostPerToken ?? 0,
      axis: "output",
      tier: "fresh",
      blocks: outputBlocks,
    },
  ];

  // Null-prototype so a category key (a bare string union) can never reach
  // Object.prototype — a stray `__proto__` from a future boundary would
  // otherwise mutate the global prototype via the bracket writes in addTokens.
  const totals: CategoryTotals = Object.create(null) as CategoryTotals;
  const blocks: AllocatedBlock[] = [];
  for (const pool of poolList) allocatePool({ pool, totals, blocks });

  // `> 0` alone accepts Infinity (an upstream div-by-zero) — which would scale
  // every category cost to Infinity, then serialise to null and silently zero
  // the span out of analytics. Require a finite positive total.
  if (
    reconcileToTotalCost != null &&
    Number.isFinite(reconcileToTotalCost) &&
    reconcileToTotalCost > 0
  ) {
    reconcileCosts(totals, reconcileToTotalCost);
  }

  return { categoryTotals: totals, blocks };
}

/**
 * Rescale per-category costs so their sum equals an authoritative span total the
 * display trusts over the rate estimate (`computeSpanCost` Priority 2). Tokens
 * are untouched — only cost is reconciled. Two cases:
 *
 *   - Rates produced a nonzero Σ → scale every category by `target / Σ`, which
 *     preserves the tier-weighted relative split (cache reads stay cheaper).
 *   - Rates produced Σ = 0 (no registry match, no custom rates) but the span
 *     still reported a real cost → distribute `target` across categories by
 *     FLAT token share. This is NOT tier-weighted: with no rate signal there is
 *     nothing to weight by, so a cheap cached prefix can absorb most of the cost
 *     simply for having the most tokens. Accepted degradation on the fully
 *     rate-less path (unknown model + explicit cost) — the alternative is to
 *     invent per-tier discount constants we can't substantiate. Cost is
 *     attributed rather than dropped; conservation (Σ = target) still holds.
 */
function reconcileCosts(totals: CategoryTotals, target: number): void {
  const entries = Object.values(totals).filter(
    (t): t is CategoryTotal => t !== undefined,
  );
  const provisional = entries.reduce((sum, t) => sum + t.costUsd, 0);

  if (provisional > 0) {
    const factor = target / provisional;
    for (const total of entries) total.costUsd *= factor;
    return;
  }

  // Accepted inherent limit: a span reporting a cost with zero usage tokens in
  // every pool has no category to attribute it to, so the cost is left off. Not
  // reachable for a real LLM call (cost implies tokens); no synthetic category
  // is manufactured for it.
  const totalTokens = entries.reduce((sum, t) => sum + t.tokens, 0);
  if (totalTokens <= 0) return;
  for (const total of entries) {
    total.costUsd = (target * total.tokens) / totalTokens;
  }
}

/**
 * Infer the cached-prefix boundary from the usage pools when the content carried
 * NO `cache_control` marker but the provider reports cached tokens.
 *
 * The Claude Code log path flattens each message's content-block array to a
 * plain string, which strips the `cache_control` markers the classifier reads to
 * locate the boundary — so `classifyBlocks` returns a null breakpoint and, left
 * uncorrected, the whole cache pool (often ~85% of a cached turn's input) dumps
 * into the axis catch-all (`other_input`).
 *
 * The cached prefix is ALWAYS the front of the input, and its size is exactly
 * `cacheRead + cacheCreation` provider tokens. Block token counts are local
 * estimates on a different scale, so the boundary is placed by the cumulative
 * estimate proportional to the cached fraction of the input. Returns the
 * boundary as a FRACTIONAL position in estimate space (not a whole-block index)
 * so `partitionInput` can split the block that straddles the cached/fresh
 * boundary — a whole-block boundary would swallow the straddling block's fresh
 * portion into the cached prefix, leaving the fresh pool blockless and dumping
 * its tokens into `other_input` (and zeroing `user_input`).
 *
 * Returns null when there is nothing to infer (no cached tokens, or no block
 * mass) — the caller then leaves the breakpoint null (all-fresh), unchanged.
 */
export function inferCachedPrefixEstTokens({
  inputBlocks,
  pools,
}: {
  inputBlocks: TokenBlock[];
  pools: UsagePools;
}): number | null {
  const cached = pools.cacheReadTokens + pools.cacheCreationTokens;
  // `pools.inputTokens` is the FRESH pool, provider-normalized upstream: for
  // OpenAI/codex — whose reported input already INCLUDES the cached tokens —
  // `extractUsagePools` subtracts the cached count, so `cached + inputTokens`
  // here is the total context, not a double-count. Anthropic reports fresh
  // input separately, so nothing is subtracted there.
  const total = cached + pools.inputTokens;
  if (cached <= 0 || total <= 0) return null;
  const estTotal = inputBlocks.reduce((sum, b) => sum + b.tokens, 0);
  if (estTotal <= 0) return null;
  return (cached / total) * estTotal;
}

/**
 * Split an ordered block list at a FRACTIONAL boundary in estimate space,
 * dividing the straddling block between the two sides (keeping idx + category on
 * both slices). `allocatePool` later rescales each pool to its provider total, so
 * the estimate-based split point only sets proportions, never the token totals.
 */
function splitBlocksAtEstBoundary(
  blocks: TokenBlock[],
  boundaryEst: number,
): { before: TokenBlock[]; after: TokenBlock[] } {
  const before: TokenBlock[] = [];
  const after: TokenBlock[] = [];
  let running = 0;
  for (const block of blocks) {
    const blockEnd = running + block.tokens;
    if (blockEnd <= boundaryEst) {
      before.push(block);
    } else if (running >= boundaryEst) {
      after.push(block);
    } else {
      const beforePortion = boundaryEst - running;
      before.push({ ...block, tokens: beforePortion });
      after.push({ ...block, tokens: block.tokens - beforePortion });
    }
    running = blockEnd;
  }
  return { before, after };
}

/**
 * Split the cached prefix across the cache_read and cache_creation pools, and
 * return the fresh remainder.
 *
 * SCALE HAZARD: `block.tokens` are local ESTIMATES; `cacheReadTokens` /
 * `cacheCreationTokens` are PROVIDER truth on a different scale (allocatePool
 * rescales each pool's blocks to its provider total afterwards). Comparing the
 * estimate cursor directly against the absolute `cacheReadTokens` mis-scales:
 * whenever the provider's read count reaches or exceeds the prefix's TOTAL
 * estimate, every block lands in cache_read, cache_creation is left blockless,
 * and allocatePool's zero-guard dumps that whole (non-empty) pool into the axis
 * catch-all — surfacing as an inflated `other_input`.
 *
 * Instead, split at the boundary PROPORTIONAL to the provider's read share,
 * measured in estimate space: `readBoundary = read/(read+creation) * estPrefix`.
 * A block straddling that boundary is split at it, keeping idx + category on both
 * slices. This guarantees every pool with a positive provider total keeps at
 * least one prefix block (so its tokens attribute to the real categories, not
 * the catch-all), while conservation still holds because allocatePool rescales
 * each pool to its provider total. When neither cache pool has capacity, the
 * breakpoint is irrelevant and everything is fresh.
 */
function partitionInput({
  inputBlocks,
  lastCacheBreakpointIndex,
  inferredCachedPrefixEstTokens,
  cacheReadTokens,
  cacheCreationTokens,
}: {
  inputBlocks: TokenBlock[];
  lastCacheBreakpointIndex: number | null;
  /** Fractional cached-prefix size (estimate space) inferred from the pools when
   * no real cache_control marker survived. Used only when there is no marker. */
  inferredCachedPrefixEstTokens: number | null;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): {
  cachePrefix: { cacheRead: TokenBlock[]; cacheCreation: TokenBlock[] };
  fresh: TokenBlock[];
} {
  const noPrefix = () => ({
    cachePrefix: {
      cacheRead: [] as TokenBlock[],
      cacheCreation: [] as TokenBlock[],
    },
    fresh: inputBlocks,
  });

  const hasCache = cacheReadTokens > 0 || cacheCreationTokens > 0;
  if (!hasCache) return noPrefix();

  let prefix: TokenBlock[];
  let fresh: TokenBlock[];
  if (lastCacheBreakpointIndex !== null && lastCacheBreakpointIndex >= 0) {
    // A REAL cache_control marker sits on a block edge, so the cached prefix is
    // whole blocks 0..index (`slice(0, index + 1)`).
    const prefixEnd = Math.min(
      lastCacheBreakpointIndex + 1,
      inputBlocks.length,
    );
    prefix = inputBlocks.slice(0, prefixEnd);
    fresh = inputBlocks.slice(prefixEnd);
  } else if (
    inferredCachedPrefixEstTokens !== null &&
    inferredCachedPrefixEstTokens > 0
  ) {
    // No marker survived: the cached/fresh boundary is a FRACTIONAL token
    // position, so split the straddling block between the cached prefix and the
    // fresh tail — a whole-block boundary would swallow the block's fresh portion
    // and leave the fresh pool blockless (→ other_input, user_input = 0 fresh).
    const split = splitBlocksAtEstBoundary(
      inputBlocks,
      inferredCachedPrefixEstTokens,
    );
    prefix = split.before;
    fresh = split.after;
  } else {
    return noPrefix();
  }

  // Within the cached prefix, split read/creation by the provider's read share
  // (see the SCALE HAZARD note above). When creation is 0 the boundary is the
  // whole prefix (all read); when read is 0 it is 0 (all creation).
  const cacheTotalTokens = cacheReadTokens + cacheCreationTokens;
  const estPrefixTokens = prefix.reduce((sum, b) => sum + b.tokens, 0);
  const readBoundary =
    cacheTotalTokens > 0
      ? (cacheReadTokens / cacheTotalTokens) * estPrefixTokens
      : estPrefixTokens;
  const { before: cacheRead, after: cacheCreation } = splitBlocksAtEstBoundary(
    prefix,
    readBoundary,
  );

  return { cachePrefix: { cacheRead, cacheCreation }, fresh };
}

/**
 * Scale a pool's block tokens so they sum EXACTLY to the pool total, add them to
 * the running category totals, and price them. The last block absorbs the
 * residual so the pool sums exactly regardless of float drift. A nonzero pool
 * with no blocks (zero-guard) drops its whole total into the axis catch-all.
 */
function allocatePool({
  pool,
  totals,
  blocks,
}: {
  pool: Pool;
  totals: CategoryTotals;
  blocks: AllocatedBlock[];
}): void {
  // Skip empty, negative, OR non-finite pools. `pool.total <= 0` alone lets a
  // NaN through (`NaN <= 0` is false), which would then poison every category
  // cost via `block.tokens * NaN`. The only caller pre-sanitises to `> 0` today,
  // but this pure module must not silently corrupt on bad input.
  if (!(pool.total > 0)) return;

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
    addTokens({
      totals,
      category: block.category,
      tokens: scaled,
      rate: pool.rate,
    });
    if (block.idx !== undefined) {
      blocks.push({
        idx: block.idx,
        category: block.category,
        // Rounded for the stored detail blob: tokens are integral by nature and
        // raw float artifacts (42.857142…) only bloat the payload. The exact
        // `scaled` value still feeds `addTokens` above, so category totals — the
        // numbers that get priced — stay precise.
        tokens: Math.round(scaled),
        cacheTier: pool.tier,
      });
    }
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
