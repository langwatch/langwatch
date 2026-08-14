/**
 * @vitest-environment node
 *
 * Suggestions run against the real catalog rather than a fixture: what is
 * under test is whether the ranking picks sensible models out of the models we
 * actually ship, and a fixture would only prove the sort function sorts.
 */
import { describe, expect, it } from "vitest";

import { MODEL_TIERS } from "~/utils/modelTierPresets";
import {
  isKnownModelId,
  partitionTierAliases,
  suggestTierTargets,
} from "../suggestTierTargets";

describe("given a tier and no provider filter", () => {
  it.each(MODEL_TIERS)("offers candidates for the %s tier", (tier) => {
    const suggestions = suggestTierTargets({ tier });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0]?.recommended).toBe(true);
    // Exactly one recommendation, or the product has to pick between them.
    expect(suggestions.filter((entry) => entry.recommended)).toHaveLength(1);
  });

  it("offers a concrete model id, never a moving name", () => {
    // Storing "openai/latest" would make the gateway dispatch a model
    // literally called "latest".
    for (const tier of MODEL_TIERS) {
      for (const suggestion of suggestTierTargets({ tier })) {
        expect(suggestion.modelId).not.toMatch(/\/latest(-mini)?$/);
        expect(isKnownModelId(suggestion.modelId)).toBe(true);
      }
    }
  });

  it("keeps the fast tier cheaper than the most capable one", () => {
    const fast = suggestTierTargets({ tier: "fast" })[0]!;
    const complex = suggestTierTargets({ tier: "complex" })[0]!;

    expect(fast.modelId).not.toBe(complex.modelId);
  });
});

describe("given the models the catalog cannot rank", () => {
  // Found by dogfooding the drawer: a music model led the "most capable"
  // list. It is marked mode "chat" and priced at zero, and the zero was
  // read as "unknown", which sorted it to the top of a descending sort.
  it("never offers a model that answers with something other than text", () => {
    for (const tier of MODEL_TIERS) {
      const ids = suggestTierTargets({ tier, limit: 50 }).map((s) => s.modelId);
      expect(ids).not.toContain("gemini/lyria-3-pro-preview");
      expect(ids).not.toContain("gemini/lyria-3-clip-preview");
    }
  });

  it("never offers a model the catalog cannot price", () => {
    // A router priced -1 means "depends", not "free". Ranking on price
    // cannot place it, and the two tiers sort in opposite directions, so
    // any stand-in is wrong in one of them.
    for (const tier of MODEL_TIERS) {
      const ids = suggestTierTargets({ tier, limit: 50 }).map((s) => s.modelId);
      expect(ids).not.toContain("openrouter/auto");
      expect(ids).not.toContain("openrouter/auto-beta");
    }
  });

  it("leads the most capable tier with a real flagship", () => {
    const top = suggestTierTargets({ tier: "complex" })[0]!;
    expect(top.recommended).toBe(true);
    expect(["openai", "anthropic", "gemini"]).toContain(top.provider);
  });
});

describe("given a policy bound to one provider", () => {
  it("never offers a model that provider cannot serve", () => {
    const suggestions = suggestTierTargets({
      tier: "complex",
      boundProviderTypes: ["anthropic"],
    });

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.provider).toBe("anthropic");
    }
  });

  it("returns nothing rather than something unreachable", () => {
    expect(
      suggestTierTargets({
        tier: "complex",
        boundProviderTypes: ["a-provider-that-does-not-exist"],
      }),
    ).toEqual([]);
  });
});

describe("given a stored model name mapping", () => {
  it("separates the reserved tier names from the ordinary ones", () => {
    const { tiers, names } = partitionTierAliases({
      complex: "anthropic/claude-opus-4-5",
      "gpt-4o": "openai/gpt-5-mini",
    });

    expect(tiers).toEqual({ complex: "anthropic/claude-opus-4-5" });
    expect(names).toEqual({ "gpt-4o": "openai/gpt-5-mini" });
  });
});
