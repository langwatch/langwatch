/**
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { describe, expect, it } from "vitest";

import {
  isModelAllowedAsRoleDefault,
  LANGY_CHAT_FEATURE_KEY,
} from "../catalog/codex-restrictions.ts";
import { allModelOptions } from "../model-options.ts";
import { modelSelectionFrom } from "../model-selection.ts";

const offered = (featureKey: string | undefined): string[] =>
  modelSelectionFrom({
    providers: [{ provider: "openai", enabled: true }],
    options: allModelOptions,
    mode: "chat",
    featureKey,
  }).selectOptions.map((option) => option.value);

describe("given an OpenAI provider and a model that takes only a high reasoning effort", () => {
  describe("when Langy's model picker options are built", () => {
    /** @scenario A model that refuses Langy's reasoning effort is not offered to Langy */
    it("drops GPT-5 Pro and keeps the pro and codex models that take medium", () => {
      const ids = offered(LANGY_CHAT_FEATURE_KEY);

      expect(ids).not.toContain("openai/gpt-5-pro");
      for (const id of ["openai/gpt-5.2-pro", "openai/o3-pro", "openai/gpt-5.3-codex"]) {
        expect(ids, id).toContain(id);
      }
    });

    /** @scenario A model that refuses Langy's reasoning effort is not offered to Langy */
    it("refuses GPT-5 Pro as the Langy role default", () => {
      expect(isModelAllowedAsRoleDefault("openai/gpt-5-pro", "LANGY")).toBe(false);
      expect(isModelAllowedAsRoleDefault("openai/gpt-5.2-pro", "LANGY")).toBe(true);
    });
  });

  describe("when another surface's picker options are built", () => {
    /** @scenario A model that refuses Langy's reasoning effort is not offered to Langy */
    it("still offers GPT-5 Pro, which runs at a high effort", () => {
      expect(offered(undefined)).toContain("openai/gpt-5-pro");
      expect(isModelAllowedAsRoleDefault("openai/gpt-5-pro", "DEFAULT")).toBe(true);
    });
  });
});
