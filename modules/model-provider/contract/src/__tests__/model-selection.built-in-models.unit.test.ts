/**
 * A built-in model is served without a provider of the project's own, so the
 * picker lists it even when the project has none configured.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  BUILT_IN_MODELS_GROUP_KEY,
  isServedOnlyAsBuiltIn,
  modelSelectionFrom,
} from "../model-selection.ts";

const BUILT_IN = { value: "langwatch/instant-evals", label: "Instant Evals" };
const OWN_DECISION_BUILT_IN = {
  value: "openai/decisions:gpt-6-luna",
  label: "OpenAI Decisions (gpt-6-luna)",
};

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
        { provider: BUILT_IN_MODELS_GROUP_KEY, label: "LangWatch", models: selectOptions },
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

      expect(groupedByProvider.map((group) => group.provider)).toEqual([
        BUILT_IN_MODELS_GROUP_KEY,
        "openai",
      ]);
    });
  });

  describe("given built-in models whose ids carry different provider prefixes", () => {
    const grouped = () =>
      modelSelectionFrom({
        providers: [{ provider: "openai", enabled: true, customModels: null }] as never,
        options: ["openai/gpt-5-mini"],
        mode: "chat",
        featureKey: undefined,
        builtInModels: [BUILT_IN, OWN_DECISION_BUILT_IN],
      }).groupedByProvider;

    it("keeps one built-in group, keyed apart from every provider's group", () => {
      const keys = grouped().map((group) => group.provider);

      expect(keys).toEqual([BUILT_IN_MODELS_GROUP_KEY, "openai"]);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("heads that one group once, and the provider's group by its own name", () => {
      const groups = grouped();

      expect(groups.filter((group) => group.label === "LangWatch")).toHaveLength(1);
      expect(groups[0]?.models.map((model) => model.value)).toEqual([
        BUILT_IN.value,
        OWN_DECISION_BUILT_IN.value,
      ]);
      expect(groups[1]?.label).toBeUndefined();
    });

    it("marks every built-in option, so no caller asks a provider row to carry it", () => {
      const { selectOptions } = modelSelectionFrom({
        providers: [],
        options: ["openai/gpt-5-mini"],
        mode: "chat",
        featureKey: undefined,
        builtInModels: [OWN_DECISION_BUILT_IN],
      });

      expect(selectOptions.map((option) => option.isBuiltIn)).toEqual([true]);
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

describe("isServedOnlyAsBuiltIn", () => {
  it("claims a decision model id, whose provider prefix cannot answer for it", () => {
    expect(isServedOnlyAsBuiltIn(OWN_DECISION_BUILT_IN.value)).toBe(true);
    expect(isServedOnlyAsBuiltIn("cloudflare/decisions:clef")).toBe(true);
  });

  it("leaves a chat model to its provider's group", () => {
    expect(isServedOnlyAsBuiltIn("openai/gpt-5-mini")).toBe(false);
    expect(isServedOnlyAsBuiltIn(BUILT_IN.value)).toBe(false);
  });
});
