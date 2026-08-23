/**
 * @vitest-environment node
 *
 * Spec: specs/ai-gateway/governance/admin-routing-policies.feature
 *       (Rule: A model tier is a reserved name a policy gives a meaning to)
 */
import { describe, expect, it } from "vitest";

import { MODEL_TIERS } from "~/utils/modelTierPresets";
import { withTierFallthrough } from "../modelTierFallthrough";

describe("given a routing policy that names a target for a tier", () => {
  /** @scenario "A tier the policy points somewhere reaches that model" */
  it("carries the tier through as an ordinary name mapping", () => {
    const aliases = withTierFallthrough({
      aliases: { complex: "anthropic/claude-opus-4-5" },
      defaultModel: null,
    });

    expect(aliases.complex).toBe("anthropic/claude-opus-4-5");
  });
});

describe("given a routing policy with a default model", () => {
  /** @scenario "A tier the policy leaves blank falls through to the default model" */
  it("answers the tiers it named, and fills the rest from the default", () => {
    const aliases = withTierFallthrough({
      aliases: { complex: "anthropic/claude-opus-4-5" },
      defaultModel: "openai/gpt-5-mini",
    });

    expect(aliases).toEqual({
      complex: "anthropic/claude-opus-4-5",
      reasoning: "openai/gpt-5-mini",
      fast: "openai/gpt-5-mini",
    });
  });

  /** @scenario "The default model answers the tier names and nothing else" */
  it("leaves an unrecognized model name out, so it is still refused", () => {
    const aliases = withTierFallthrough({
      aliases: {},
      defaultModel: "openai/gpt-5-mini",
    });

    // A catch-all here would serve a caller a model they never named, bill
    // every typo, and make models_allowed unenforceable, because nothing
    // would ever reach the rejection.
    expect(aliases["gpt-4o-typo"]).toBeUndefined();
    expect(Object.keys(aliases).sort()).toEqual([...MODEL_TIERS].sort());
  });

  it("never overwrites a mapping the policy set itself", () => {
    const aliases = withTierFallthrough({
      aliases: { "gpt-4o": "openai/gpt-5-mini", fast: "openai/gpt-5-nano" },
      defaultModel: "openai/gpt-5-mini",
    });

    expect(aliases["gpt-4o"]).toBe("openai/gpt-5-mini");
    expect(aliases.fast).toBe("openai/gpt-5-nano");
  });
});

describe("given a routing policy with no default model", () => {
  /** @scenario "A policy with no default model leaves its unanswered tiers out" */
  it("carries only the tiers it named", () => {
    const aliases = withTierFallthrough({
      aliases: { fast: "openai/gpt-5-mini" },
      defaultModel: null,
    });

    expect(aliases).toEqual({ fast: "openai/gpt-5-mini" });
  });

  it("treats an empty default model the same as none at all", () => {
    const aliases = withTierFallthrough({
      aliases: { fast: "openai/gpt-5-mini" },
      defaultModel: "",
    });

    expect(aliases).toEqual({ fast: "openai/gpt-5-mini" });
  });
});
