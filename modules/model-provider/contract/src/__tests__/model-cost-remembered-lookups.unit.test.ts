import safe from "safe-regex2";
import { describe, expect, it } from "vitest";

import { llmModels } from "../catalog/model-catalog.ts";
import { getStaticModelCostRates } from "../catalog/static-model-costs.ts";
import {
  findMatchingModelCost,
  normalizeBedrockModelId,
  normalizeModelName,
} from "../model-cost.ts";
import type { ModelCostRate } from "../model-provider.ts";

/**
 * The lookup as it was before it remembered anything: every call scans the whole list in order,
 * looking each pattern up in a cache of compiled patterns. Kept verbatim as the reference the
 * remembered lookup must agree with.
 */
const referencePatterns = new Map<string, RegExp | null>();
const compile = (pattern: string): RegExp | null => {
  const cached = referencePatterns.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    const regex = new RegExp(pattern);
    compiled = safe(regex) ? regex : null;
  } catch {
    compiled = null;
  }
  referencePatterns.set(pattern, compiled);
  return compiled;
};

const referenceMatch = (model: string, costs: readonly ModelCostRate[]): ModelCostRate[] => {
  const scan = (name: string): ModelCostRate | undefined => {
    const matched = costs.find((cost) => compile(cost.regex)?.test(name));
    if (matched) return matched;
    if (name.includes("/")) return scan(name.slice(name.indexOf("/") + 1));
    return undefined;
  };
  const candidate = (name: string): ModelCostRate | undefined => {
    const raw = scan(name);
    if (raw) return raw;
    const normalized = normalizeModelName(name);
    return normalized === name ? undefined : scan(normalized);
  };
  const subtypeStripped = (): ModelCostRate | undefined => {
    const slash = model.indexOf("/");
    if (slash === -1) return undefined;
    const provider = model.slice(0, slash);
    if (!provider.includes(".")) return undefined;
    return candidate(provider.split(".")[0] + model.slice(slash));
  };
  const bedrock = (): ModelCostRate | undefined => {
    const id = normalizeBedrockModelId(model);
    return id === model ? undefined : candidate(id);
  };
  const match = candidate(model) ?? subtypeStripped() ?? bedrock();
  return match ? [match] : [];
};

const catalogue = getStaticModelCostRates();

/** Model names spans carry, drawn from the catalogue, the other suites' fixtures and the wild. */
const modelNames = (): string[] => {
  const ids = [...Object.keys(llmModels.models), ...catalogue.map((rate) => rate.model)];
  const bare = ids.map((id) => id.split("/").slice(1).join("/") || id);
  const fixtures = [
    "anthropic/claude-opus-5[1m]",
    "bedrock/eu.anthropic.claude-sonnet-4-6",
    "eu.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-3-5-sonnet-20240620-v1:0",
    "bedrock/anthropic.claude-3-haiku-20240307-v1:0",
    "claude-opus-4-5",
    "claude-opus-4.6",
    "claude-sonnet-4-5[1m]",
    "claude-sonnet-4-5-20250929",
    "custom.eu/foo-model",
    "other.eu/foo-model",
    "deepseek-ai/deepseek-v3.2",
    "minimaxai/minimax-m2.1",
    "minimax-m2-1",
    "gpt-4o",
    "GPT-4O",
    "OpenAI/GPT-4O",
    "gpt-4o-awq",
    "gpt-4o-fp8",
    "gpt-4o-gptq",
    "gpt-4o-turbo",
    "gpt-4o-2024-08-06",
    "together_ai/gpt-4o",
    "together_ai/openai/gpt-4o",
    "azure/gpt-4o-mini",
    "vertex_ai/gemini-2.5-pro",
    "openai_codex/gpt-5.6-terra",
    "MyModel-V2",
    "my-fine-tune-v3",
    "acme/my-fine-tune",
    "aaaa",
    "made-up-model-xyz",
    "acme/internal-llm-7b",
    "",
    "/",
  ];
  return [
    ...new Set([
      ...ids,
      ...bare,
      ...bare.map((name) => `openrouter/${name}`),
      ...bare.map((name) => name.toUpperCase()),
      ...bare.map((name) => `${name}-fp8`),
      ...bare.map((name) => `${name}-2099-01-01`),
      ...fixtures,
    ]),
  ];
};

const customRules: ModelCostRate[] = [
  { model: "my-fine-tune", regex: "^my-fine-tune", inputCostPerToken: 1, outputCostPerToken: 1 },
  { model: "gpt-4o override", regex: "^(openai\\/)?gpt-4o$", inputCostPerToken: 2 },
  { model: "unsafe", regex: "^(a+)+$", inputCostPerToken: 3 },
  { model: "invalid", regex: "([", inputCostPerToken: 4 },
];

describe("findMatchingModelCost remembering its answers", () => {
  describe("when looking up every model name against the full catalogue", () => {
    it("picks the same rate as a full scan, on the first and on a repeated lookup", () => {
      const names = modelNames();
      expect(names.length).toBeGreaterThan(1_000);
      for (const round of ["first", "repeat"]) {
        for (const name of names) {
          expect(findMatchingModelCost(name, catalogue), `${round}: ${name}`).toEqual(
            referenceMatch(name, catalogue),
          );
        }
      }
    });
  });

  describe("when a project's custom rules come ahead of the catalogue", () => {
    it("picks the same rate as a full scan, misses included", () => {
      const merged = [...customRules, ...catalogue];
      for (const name of modelNames()) {
        const expected = referenceMatch(name, merged);
        expect(findMatchingModelCost(name, merged), name).toEqual(expected);
        expect(findMatchingModelCost(name, [...customRules, ...catalogue]), name).toEqual(expected);
      }
    });
  });

  describe("when the same model name is looked up in different cost lists", () => {
    it("answers from each list's own rates", () => {
      const first = [{ model: "first", regex: "^my-model" }];
      const second = [{ model: "second", regex: "^my-model" }];

      expect(findMatchingModelCost("my-model", first)[0]?.model).toBe("first");
      expect(findMatchingModelCost("my-model", second)[0]?.model).toBe("second");
      expect(findMatchingModelCost("my-model", [])).toEqual([]);
    });
  });

  describe("when a model name missed and a rule for it is then added to the list", () => {
    it("finds the new rule", () => {
      const rules: ModelCostRate[] = [{ model: "other", regex: "^other" }];
      expect(findMatchingModelCost("late-model", rules)).toEqual([]);

      rules.unshift({ model: "late", regex: "^late-model" });

      expect(findMatchingModelCost("late-model", rules)[0]?.model).toBe("late");
      expect(findMatchingModelCost("other", rules)[0]?.model).toBe("other");
    });
  });

  describe("when more model names are looked up than one list remembers", () => {
    it("keeps answering like a full scan", () => {
      const rules: ModelCostRate[] = [
        { model: "even", regex: "[02468]$" },
        { model: "any", regex: "^model-" },
      ];
      for (let index = 0; index < 5_000; index++) {
        const name = `model-${index}`;
        expect(findMatchingModelCost(name, rules)).toEqual(referenceMatch(name, rules));
      }
      expect(findMatchingModelCost("model-2", rules)[0]?.model).toBe("even");
      expect(findMatchingModelCost("unknown", rules)).toEqual([]);
    });
  });
});
