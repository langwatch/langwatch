import { describe, expect, it } from "vitest";
import { type Category, InputCategory, OutputCategory } from "../categories";
import {
  allocateCategoryCosts,
  type TierPrices,
  type TokenBlock,
  type UsagePools,
} from "../costAllocation.service";

const INPUT_CATEGORIES: Category[] = [
  InputCategory.SYSTEM_PROMPT,
  InputCategory.USER_INPUT,
  InputCategory.PRIOR_CONTEXT,
  InputCategory.TOOL_RESULT_MCP,
  InputCategory.MCP_TOOL_DEFINITIONS,
];
const OUTPUT_CATEGORIES: Category[] = [
  OutputCategory.ASSISTANT_TEXT,
  OutputCategory.TOOL_CALL_MCP,
  OutputCategory.THINKING,
];

const sumCosts = (
  totals: Partial<Record<Category, { costUsd: number }>>,
): number => Object.values(totals).reduce((n, t) => n + (t?.costUsd ?? 0), 0);

const sumTokens = (
  totals: Partial<Record<Category, { tokens: number }>>,
): number => Object.values(totals).reduce((n, t) => n + (t?.tokens ?? 0), 0);

// Deterministic PRNG (mulberry32) so the property loop is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("allocateCategoryCosts", () => {
  describe("given random block sets and provider usage totals", () => {
    /** @scenario "Per-category costs sum exactly to the span's real cost" */
    it("keeps per-category cost equal to the span's real cost across 100 draws", () => {
      const rng = mulberry32(0x5319);

      for (let iter = 0; iter < 100; iter++) {
        const pools: UsagePools = {
          inputTokens: Math.floor(rng() * 5000),
          cacheReadTokens: Math.floor(rng() * 5000),
          cacheCreationTokens: Math.floor(rng() * 5000),
          outputTokens: Math.floor(rng() * 5000),
        };
        const prices: TierPrices = {
          inputCostPerToken: rng() * 1e-5,
          outputCostPerToken: rng() * 3e-5,
          cacheReadCostPerToken: rng() * 1e-6,
          cacheCreationCostPerToken: rng() * 1.3e-5,
        };

        const inputBlocks = randomBlocks(rng, INPUT_CATEGORIES);
        const outputBlocks = randomBlocks(rng, OUTPUT_CATEGORIES);
        const breakpoint =
          inputBlocks.length > 0 && rng() > 0.3
            ? Math.floor(rng() * inputBlocks.length)
            : null;

        // On ~half the draws, supply an authoritative total the display trusts
        // over the rates — the reconcile path must land Σ EXACTLY on it, giving
        // the reconciliation branch the same randomized exhaustiveness as the
        // base allocation.
        const reconcileTarget = rng() > 0.5 ? rng() * 0.5 : null;

        const { categoryTotals } = allocateCategoryCosts({
          inputBlocks,
          outputBlocks,
          lastCacheBreakpointIndex: breakpoint,
          pools,
          prices,
          reconcileToTotalCost: reconcileTarget,
        });

        const trueCost =
          pools.inputTokens * (prices.inputCostPerToken ?? 0) +
          pools.cacheReadTokens * (prices.cacheReadCostPerToken ?? 0) +
          pools.cacheCreationTokens * (prices.cacheCreationCostPerToken ?? 0) +
          pools.outputTokens * (prices.outputCostPerToken ?? 0);

        // With a reconcile target, Σ cost must equal it exactly (unless there
        // were no tokens at all to attribute to — the accepted zero-token limit).
        const hasTokens =
          pools.inputTokens +
            pools.cacheReadTokens +
            pools.cacheCreationTokens +
            pools.outputTokens >
          0;
        const expectedCost =
          reconcileTarget !== null && hasTokens ? reconcileTarget : trueCost;
        expect(Math.abs(sumCosts(categoryTotals) - expectedCost)).toBeLessThan(
          1e-9,
        );

        const trueTokens =
          pools.inputTokens +
          pools.cacheReadTokens +
          pools.cacheCreationTokens +
          pools.outputTokens;
        expect(Math.abs(sumTokens(categoryTotals) - trueTokens)).toBeLessThan(
          1e-6,
        );
      }
    });
  });

  describe("given the first turn of a session with cache creation and no cache read", () => {
    /** @scenario "Costs are conserved on the first turn of a session with cache creation" */
    it("conserves cost with the whole prefix priced at the cache-creation rate", () => {
      const inputBlocks: TokenBlock[] = [
        { category: InputCategory.SYSTEM_PROMPT, tokens: 800 },
        { category: InputCategory.MCP_TOOL_DEFINITIONS, tokens: 200 },
        { category: InputCategory.USER_INPUT, tokens: 50 },
      ];
      const pools: UsagePools = {
        inputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 1000,
        outputTokens: 100,
      };
      const prices: TierPrices = {
        inputCostPerToken: 3e-6,
        cacheCreationCostPerToken: 3.75e-6,
        cacheReadCostPerToken: 3e-7,
        outputCostPerToken: 1.5e-5,
      };

      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks,
        outputBlocks: [],
        lastCacheBreakpointIndex: 1, // prefix = system + mcp defs
        pools,
        prices,
      });

      const trueCost =
        pools.cacheCreationTokens * prices.cacheCreationCostPerToken! +
        pools.inputTokens * prices.inputCostPerToken! +
        pools.outputTokens * prices.outputCostPerToken!;
      expect(Math.abs(sumCosts(categoryTotals) - trueCost)).toBeLessThan(1e-9);

      // System prompt was in the prefix, so it is priced at cache-creation.
      const sys = categoryTotals[InputCategory.SYSTEM_PROMPT]!;
      expect(sys.costUsd).toBeCloseTo(
        sys.tokens * prices.cacheCreationCostPerToken!,
        12,
      );
    });
  });

  describe("given a cached prefix served from cache", () => {
    /** @scenario "Cached prefix categories are priced at the cache-read rate" */
    it("prices prefix categories at cache-read and post-prefix at the fresh rate", () => {
      const inputBlocks: TokenBlock[] = [
        { category: InputCategory.SYSTEM_PROMPT, tokens: 1000 },
        { category: InputCategory.USER_INPUT, tokens: 40 },
      ];
      const pools: UsagePools = {
        inputTokens: 40,
        cacheReadTokens: 1000,
        cacheCreationTokens: 0,
        outputTokens: 20,
      };
      const prices: TierPrices = {
        inputCostPerToken: 3e-6,
        cacheReadCostPerToken: 3e-7,
        cacheCreationCostPerToken: 3.75e-6,
        outputCostPerToken: 1.5e-5,
      };

      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks,
        outputBlocks: [],
        lastCacheBreakpointIndex: 0, // prefix = system prompt only
        pools,
        prices,
      });

      const sys = categoryTotals[InputCategory.SYSTEM_PROMPT]!;
      const user = categoryTotals[InputCategory.USER_INPUT]!;
      expect(sys.costUsd).toBeCloseTo(
        sys.tokens * prices.cacheReadCostPerToken!,
        12,
      );
      expect(user.costUsd).toBeCloseTo(
        user.tokens * prices.inputCostPerToken!,
        12,
      );
    });
  });

  describe("given a single cached-prefix block straddling the read→creation boundary", () => {
    it("splits the block across both tiers instead of dumping half into the catch-all", () => {
      // Regression: a 1000-token system_prompt with cacheRead=500 / creation=500
      // used to assign the whole block to cache_read, leaving the creation pool
      // blockless — the zero-guard then dumped its 500 tokens into other_input,
      // so the customer saw half their system prompt as "Other input"
      // (conservation still held, so the totals-only tests missed it).
      const inputBlocks: TokenBlock[] = [
        { idx: 0, category: InputCategory.SYSTEM_PROMPT, tokens: 1000 },
      ];
      const pools: UsagePools = {
        inputTokens: 0,
        cacheReadTokens: 500,
        cacheCreationTokens: 500,
        outputTokens: 0,
      };

      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks,
        outputBlocks: [],
        lastCacheBreakpointIndex: 0,
        pools,
        prices: {},
      });

      // Whole block stays system_prompt across both cache tiers; nothing leaks
      // into the input catch-all.
      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]?.tokens).toBe(1000);
      expect(categoryTotals[InputCategory.OTHER_INPUT]).toBeUndefined();
    });
  });

  describe("given usage reported but no attributable blocks", () => {
    /** @scenario "Usage with no attributable blocks lands in the catch-all category" */
    it("records the unattributable usage under the catch-all and drops nothing", () => {
      const pools: UsagePools = {
        inputTokens: 500,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 300,
      };
      const prices: TierPrices = {
        inputCostPerToken: 3e-6,
        outputCostPerToken: 1.5e-5,
      };

      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [],
        outputBlocks: [],
        lastCacheBreakpointIndex: null,
        pools,
        prices,
      });

      expect(categoryTotals[InputCategory.OTHER_INPUT]?.tokens).toBe(500);
      expect(categoryTotals[OutputCategory.OTHER_OUTPUT]?.tokens).toBe(300);
      const trueCost =
        pools.inputTokens * prices.inputCostPerToken! +
        pools.outputTokens * prices.outputCostPerToken!;
      expect(Math.abs(sumCosts(categoryTotals) - trueCost)).toBeLessThan(1e-9);
    });
  });

  describe("given blocks present but with zero total token mass", () => {
    it("routes the pool total to the catch-all instead of dividing by zero", () => {
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [
          { category: InputCategory.SYSTEM_PROMPT, tokens: 0 },
          { category: InputCategory.USER_INPUT, tokens: 0 },
        ],
        outputBlocks: [{ category: OutputCategory.ASSISTANT_TEXT, tokens: 0 }],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 400,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 120,
        },
        prices: { inputCostPerToken: 3e-6, outputCostPerToken: 1.5e-5 },
      });

      // The zero-mass blocks attract nothing; the whole pool total lands in the
      // axis catch-all so no usage is dropped and the sum still reconciles.
      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]).toBeUndefined();
      expect(categoryTotals[InputCategory.USER_INPUT]).toBeUndefined();
      expect(categoryTotals[InputCategory.OTHER_INPUT]?.tokens).toBe(400);
      expect(categoryTotals[OutputCategory.OTHER_OUTPUT]?.tokens).toBe(120);
      const trueCost = 400 * 3e-6 + 120 * 1.5e-5;
      expect(Math.abs(sumCosts(categoryTotals) - trueCost)).toBeLessThan(1e-9);
    });
  });

  describe("given input blocks carrying their source idx", () => {
    it("returns per-block detail with the scaled tokens and cache tier", () => {
      const { blocks } = allocateCategoryCosts({
        inputBlocks: [
          { idx: 0, category: InputCategory.SYSTEM_PROMPT, tokens: 1000 },
          { idx: 1, category: InputCategory.USER_INPUT, tokens: 40 },
        ],
        outputBlocks: [
          { idx: 0, category: OutputCategory.ASSISTANT_TEXT, tokens: 20 },
        ],
        lastCacheBreakpointIndex: 0, // prefix = system prompt only
        pools: {
          inputTokens: 40,
          cacheReadTokens: 1000,
          cacheCreationTokens: 0,
          outputTokens: 20,
        },
        prices: {
          inputCostPerToken: 3e-6,
          cacheReadCostPerToken: 3e-7,
          outputCostPerToken: 1.5e-5,
        },
      });

      const system = blocks.find(
        (b) => b.category === InputCategory.SYSTEM_PROMPT,
      );
      const user = blocks.find((b) => b.category === InputCategory.USER_INPUT);
      const assistant = blocks.find(
        (b) => b.category === OutputCategory.ASSISTANT_TEXT,
      );

      // The system prompt is in the cached prefix, the user input is fresh.
      expect(system).toMatchObject({
        idx: 0,
        cacheTier: "cache_read",
        tokens: 1000,
      });
      expect(user).toMatchObject({ idx: 1, cacheTier: "fresh", tokens: 40 });
      expect(assistant).toMatchObject({
        idx: 0,
        cacheTier: "fresh",
        tokens: 20,
      });
    });

    it("omits synthetic catch-all tokens from the per-block detail", () => {
      const { blocks, categoryTotals } = allocateCategoryCosts({
        inputBlocks: [],
        outputBlocks: [],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 500,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
        },
        prices: { inputCostPerToken: 3e-6 },
      });

      // The unattributable usage lands in categoryTotals but has no source block.
      expect(categoryTotals[InputCategory.OTHER_INPUT]?.tokens).toBe(500);
      expect(blocks).toHaveLength(0);
    });
  });

  describe("given a tier with no price", () => {
    it("allocates the tokens but prices that tier at zero", () => {
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [{ category: InputCategory.SYSTEM_PROMPT, tokens: 100 }],
        outputBlocks: [{ category: OutputCategory.ASSISTANT_TEXT, tokens: 50 }],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 50,
        },
        prices: { outputCostPerToken: 1e-5 }, // no input rate
      });

      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]?.tokens).toBe(100);
      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]?.costUsd).toBe(0);
      expect(
        categoryTotals[OutputCategory.ASSISTANT_TEXT]?.costUsd,
      ).toBeCloseTo(50 * 1e-5, 12);
    });
  });

  describe("given an authoritative span cost the display trusts over the rates", () => {
    it("rescales per-category costs so their sum equals that cost, tokens untouched", () => {
      // Registry rates would price this span at 100*1e-6 + 50*1e-5 = 6e-4, but
      // the provider billed 0.02 (e.g. Claude Code cost_usd). Categories must
      // reconcile to the displayed 0.02, not the estimate.
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [{ category: InputCategory.SYSTEM_PROMPT, tokens: 100 }],
        outputBlocks: [{ category: OutputCategory.ASSISTANT_TEXT, tokens: 50 }],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 50,
        },
        prices: { inputCostPerToken: 1e-6, outputCostPerToken: 1e-5 },
        reconcileToTotalCost: 0.02,
      });

      expect(sumCosts(categoryTotals)).toBeCloseTo(0.02, 12);
      // Tokens are never rescaled — only cost is reconciled.
      expect(sumTokens(categoryTotals)).toBe(150);
      // The tier-weighted split is preserved: output (5e-4) carried 5/6 of the
      // provisional 6e-4, so it keeps 5/6 of the reconciled total.
      expect(
        categoryTotals[OutputCategory.ASSISTANT_TEXT]?.costUsd,
      ).toBeCloseTo(0.02 * (5 / 6), 10);
    });

    it("distributes the cost by token share when no rate produced any cost", () => {
      // No rates and no registry match → provisional Σ is 0, but the span still
      // reported a real cost. It must be attributed by token share, not dropped.
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [{ category: InputCategory.SYSTEM_PROMPT, tokens: 300 }],
        outputBlocks: [
          { category: OutputCategory.ASSISTANT_TEXT, tokens: 100 },
        ],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 300,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 100,
        },
        prices: {},
        reconcileToTotalCost: 0.04,
      });

      expect(sumCosts(categoryTotals)).toBeCloseTo(0.04, 12);
      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]?.costUsd).toBeCloseTo(
        0.04 * (300 / 400),
        12,
      );
      expect(
        categoryTotals[OutputCategory.ASSISTANT_TEXT]?.costUsd,
      ).toBeCloseTo(0.04 * (100 / 400), 12);
    });

    it("leaves rate-derived costs untouched when the reconcile target is absent", () => {
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [{ category: InputCategory.SYSTEM_PROMPT, tokens: 100 }],
        outputBlocks: [],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
        },
        prices: { inputCostPerToken: 1e-6 },
        reconcileToTotalCost: null,
      });

      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]?.costUsd).toBeCloseTo(
        100 * 1e-6,
        12,
      );
    });

    it("treats a zero reconcile target as no-op, keeping rate-derived costs", () => {
      // The guard is `!= null && > 0`, so 0 must not wipe the rate estimate.
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [{ category: InputCategory.SYSTEM_PROMPT, tokens: 100 }],
        outputBlocks: [],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 100,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
        },
        prices: { inputCostPerToken: 1e-6 },
        reconcileToTotalCost: 0,
      });

      expect(categoryTotals[InputCategory.SYSTEM_PROMPT]?.costUsd).toBeCloseTo(
        100 * 1e-6,
        12,
      );
    });

    it("drops an authoritative cost that has no tokens to attribute it to (accepted limit)", () => {
      // A span reporting a cost with zero usage in every pool has no category to
      // carry it — the accepted zero-token limit. No synthetic category, no throw.
      const { categoryTotals } = allocateCategoryCosts({
        inputBlocks: [],
        outputBlocks: [],
        lastCacheBreakpointIndex: null,
        pools: {
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 0,
        },
        prices: {},
        reconcileToTotalCost: 0.02,
      });

      expect(sumCosts(categoryTotals)).toBe(0);
      expect(Object.keys(categoryTotals)).toHaveLength(0);
    });
  });
});

function randomBlocks(rng: () => number, categories: Category[]): TokenBlock[] {
  const count = Math.floor(rng() * 8);
  const blocks: TokenBlock[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push({
      category: categories[Math.floor(rng() * categories.length)]!,
      // Occasionally zero tokens to exercise the degenerate-mass guard.
      tokens: rng() > 0.15 ? Math.floor(rng() * 1000) : 0,
    });
  }
  return blocks;
}
