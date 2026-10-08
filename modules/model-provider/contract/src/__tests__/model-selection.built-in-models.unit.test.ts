/**
 * A built-in model is served without a provider of the project's own, so the
 * picker lists it even when the project has none configured.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it } from "vitest";

import { modelSelectionFrom } from "../model-selection.ts";

const BUILT_IN = { value: "langwatch/instant-evals", label: "Instant Evals" };

describe("modelSelectionFrom", () => {
  describe("given a built-in model and no provider", () => {
    it("lists the built-in model, in its own group, by its label", () => {
      const { selectOptions, groupedByProvider } = modelSelectionFrom({
        providers: [],
        options: ["openai/gpt-5-mini"],
        mode: "chat",
        featureKey: undefined,
        builtInModels: [BUILT_IN],
      });

      expect(selectOptions.map((option) => option.value)).toEqual(["langwatch/instant-evals"]);
      expect(selectOptions[0]?.label).toBe("Instant Evals");
      expect(groupedByProvider).toEqual([
        { provider: "langwatch", label: "LangWatch", models: selectOptions },
      ]);
    });
  });

  describe("given a built-in model and a configured provider", () => {
    it("lists the built-in model first, before the provider's models", () => {
      const { groupedByProvider } = modelSelectionFrom({
        providers: [{ provider: "openai", enabled: true, customModels: null }] as never,
        options: ["openai/gpt-5-mini"],
        mode: "chat",
        featureKey: undefined,
        builtInModels: [BUILT_IN],
      });

      expect(groupedByProvider.map((group) => group.provider)).toEqual(["langwatch", "openai"]);
    });
  });

  describe("given a built-in model that is labelled but not offered", () => {
    /** @scenario "The model picker names a saved Instant Evals judge it does not offer" */
    it("keeps it out of the options and names it among the labelled ones", () => {
      const { selectOptions, groupedByProvider, labelledOptions } = modelSelectionFrom({
        providers: [],
        options: ["openai/gpt-5-mini"],
        mode: "chat",
        featureKey: undefined,
        builtInModels: [{ ...BUILT_IN, isOffered: false }],
      });

      expect(selectOptions).toEqual([]);
      expect(groupedByProvider).toEqual([]);
      expect(labelledOptions.map((option) => option.label)).toEqual(["Instant Evals"]);
    });
  });

  describe("given no built-in model", () => {
    it("lists nothing for a project with no provider", () => {
      const { selectOptions } = modelSelectionFrom({
        providers: [],
        options: ["openai/gpt-5-mini"],
        mode: "chat",
        featureKey: undefined,
      });

      expect(selectOptions).toEqual([]);
    });
  });
});
