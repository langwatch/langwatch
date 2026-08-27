import { describe, expect, it } from "vitest";
import { getStaticModelCosts } from "../../../modelProviders/llmModelCost";
import { matchModelCostWithFallbacks } from "../../../tracer/collector/cost";
import { computeSpanCost } from "../model-cost-matching";

/**
 * Claude Code appends "[1m]" to the model id when the 1M-token context
 * window is active. Registry regexes are prefix-anchored, so the suffix is
 * absorbed by the base entry. Per Anthropic's published pricing
 * (platform.claude.com docs/en/about-claude/pricing, "Long context
 * pricing", retrieved 2026-07-27), Claude 4.6+ models bill the full 1M
 * window at standard per-token rates with no premium above 200K input
 * tokens, so the base entry's rates are the correct [1m] rates.
 *
 * The expected per-token rates below are Anthropic's Opus 5 price sheet
 * (input $5/MTok, output $25/MTok, 5m cache write $6.25/MTok, cache read
 * $0.50/MTok). If a registry sync changes them, re-verify against the
 * pricing page before updating the constants.
 */
const OPUS_5_INPUT = 0.000005;
const OPUS_5_OUTPUT = 0.000025;
const OPUS_5_CACHE_WRITE = 0.00000625;
const OPUS_5_CACHE_READ = 0.0000005;

describe("long-context [1m] model cost matching", () => {
  /** @scenario "A [1m] long-context model id is priced as its base model" */
  it("matches claude-opus-5[1m] to the anthropic/claude-opus-5 registry entry at standard rates", () => {
    const match = matchModelCostWithFallbacks("claude-opus-5[1m]", getStaticModelCosts());

    expect(match?.model).toBe("anthropic/claude-opus-5");
    expect(match?.inputCostPerToken).toBe(OPUS_5_INPUT);
    expect(match?.outputCostPerToken).toBe(OPUS_5_OUTPUT);
    expect(match?.cacheCreationCostPerToken).toBe(OPUS_5_CACHE_WRITE);
    expect(match?.cacheReadCostPerToken).toBe(OPUS_5_CACHE_READ);
  });

  /** @scenario "A Claude Code span on claude-opus-5[1m] with cache traffic gets a nonzero cost" */
  it("computes a nonzero cost for the literal claude-opus-5[1m] with cache tokens", () => {
    // The customer-reported span: model chip claude-opus-5[1m], cache read
    // 20540 and cache write 22994 tokens, which showed no cost.
    const result = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "claude-opus-5[1m]",
        "gen_ai.usage.cache_read.input_tokens": 20540,
        "gen_ai.usage.cache_creation.input_tokens": 22994,
      },
      promptTokens: 0,
      completionTokens: 0,
    });

    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(20540 * OPUS_5_CACHE_READ + 22994 * OPUS_5_CACHE_WRITE, 10);
  });

  /** @scenario "A Claude Code span on claude-opus-5[1m] with cache traffic gets a nonzero cost" */
  it("adds fresh input and output tokens at the standard Opus 5 rates", () => {
    const result = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "claude-opus-5[1m]",
        "gen_ai.usage.cache_read.input_tokens": 20540,
        "gen_ai.usage.cache_creation.input_tokens": 22994,
      },
      promptTokens: 1000,
      completionTokens: 500,
    });

    expect(result).toBeCloseTo(
      1000 * OPUS_5_INPUT +
        500 * OPUS_5_OUTPUT +
        20540 * OPUS_5_CACHE_READ +
        22994 * OPUS_5_CACHE_WRITE,
      10,
    );
  });

  /** @scenario "The [1m] suffix is priced as the base model across the Claude family" */
  it("resolves the [1m] suffix for other Claude spellings too", () => {
    const costs = getStaticModelCosts();

    expect(matchModelCostWithFallbacks("claude-sonnet-4-5[1m]", costs)?.model).toBe(
      "anthropic/claude-sonnet-4-5",
    );
    expect(matchModelCostWithFallbacks("anthropic/claude-opus-5[1m]", costs)?.model).toBe(
      "anthropic/claude-opus-5",
    );
  });
});
