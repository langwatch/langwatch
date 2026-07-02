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

        const { categoryTotals } = allocateCategoryCosts({
          inputBlocks,
          outputBlocks,
          lastCacheBreakpointIndex: breakpoint,
          pools,
          prices,
        });

        const trueCost =
          pools.inputTokens * (prices.inputCostPerToken ?? 0) +
          pools.cacheReadTokens * (prices.cacheReadCostPerToken ?? 0) +
          pools.cacheCreationTokens * (prices.cacheCreationCostPerToken ?? 0) +
          pools.outputTokens * (prices.outputCostPerToken ?? 0);

        expect(Math.abs(sumCosts(categoryTotals) - trueCost)).toBeLessThan(
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

  describe("given usage reported but no attributable blocks", () => {
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
