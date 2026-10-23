import { describe, expect, it } from "vitest";

import { llmModels } from "../catalog/model-catalog.ts";
import { getStaticModelCostRates } from "../catalog/static-model-costs.ts";
import { findMatchingModelCost } from "../model-cost.ts";
import type { ModelCostRate } from "../model-provider.ts";

/** The oracle: a copy of the list is a new key, so its first lookup is a cold full scan. */
const coldMatch = (model: string, costs: readonly ModelCostRate[]): ModelCostRate[] =>
  findMatchingModelCost(model, [...costs]);

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
  // Backtracking-prone on purpose, built in two pieces so static analysis skips the fixture.
  { model: "unsafe", regex: ["^(a", "+)+$"].join(""), inputCostPerToken: 3 },
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
            coldMatch(name, catalogue),
          );
        }
      }
    });
  });

  describe("when a project's custom rules come ahead of the catalogue", () => {
    it("picks the same rate as a full scan, misses included", () => {
      const merged = [...customRules, ...catalogue];
      for (const name of modelNames()) {
        const expected = coldMatch(name, merged);
        expect(findMatchingModelCost(name, merged), name).toEqual(expected);
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

  describe("when a model name missed and a rule for it arrives in a new list", () => {
    it("finds the new rule", () => {
      const rules: ModelCostRate[] = [{ model: "other", regex: "^other" }];
      expect(findMatchingModelCost("late-model", rules)).toEqual([]);

      const changed = [{ model: "late", regex: "^late-model" }, ...rules];

      expect(findMatchingModelCost("late-model", changed)[0]?.model).toBe("late");
      expect(findMatchingModelCost("other", changed)[0]?.model).toBe("other");
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
        expect(findMatchingModelCost(name, rules)).toEqual(coldMatch(name, rules));
      }
      expect(findMatchingModelCost("model-2", rules)[0]?.model).toBe("even");
      expect(findMatchingModelCost("unknown", rules)).toEqual([]);
    });
  });

  describe("when the same model name is looked up again in one list", () => {
    const countingList = (): { costs: ModelCostRate[]; reads: () => number } => {
      let reads = 0;
      const rule = (model: string, pattern: string): ModelCostRate => ({
        model,
        get regex() {
          reads += 1;
          return pattern;
        },
      });
      return { costs: [rule("a", "^alpha"), rule("b", "^beta")], reads: () => reads };
    };

    it("does not evaluate the patterns again for a hit", () => {
      const { costs, reads } = countingList();
      findMatchingModelCost("beta-1", costs);
      const readsAfterFirst = reads();

      const second = findMatchingModelCost("beta-1", costs);

      expect(readsAfterFirst).toBeGreaterThan(0);
      expect(reads()).toBe(readsAfterFirst);
      expect(second[0]?.model).toBe("b");
    });

    it("does not evaluate the patterns again for a miss", () => {
      const { costs, reads } = countingList();
      findMatchingModelCost("gamma-1", costs);
      const readsAfterFirst = reads();

      const second = findMatchingModelCost("gamma-1", costs);

      expect(readsAfterFirst).toBeGreaterThan(0);
      expect(reads()).toBe(readsAfterFirst);
      expect(second).toEqual([]);
    });
  });
});
