/**
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { describe, expect, it } from "vitest";

import { allModelOptions } from "../../model-options.ts";
import { getModelsForProvider, isPickableCatalogModel } from "../model-catalog.ts";

describe("given the committed model catalog", () => {
  const catalogIds = new Set(getModelsForProvider("openai").map((model) => model.id));

  describe("when the model picker options are built", () => {
    /** @scenario A batch-priced tier is not offered */
    it("offers a model but never its batch-priced tier", () => {
      expect(catalogIds.has("openai/gpt-6-sol:batch")).toBe(true);
      expect(allModelOptions).toContain("openai/gpt-6-sol");
      expect(allModelOptions.filter((id) => id.endsWith(":batch"))).toEqual([]);
    });

    /** @scenario A tiered pro serving mode OpenAI does not serve is not offered */
    it("drops the tiered pro ids and keeps OpenAI's own pro ids", () => {
      for (const id of [
        "openai/gpt-6-sol-pro",
        "openai/gpt-6.1-terra-pro",
        "openai/gpt-5.6-luna-pro",
      ]) {
        expect(catalogIds.has(id), id).toBe(true);
        expect(allModelOptions, id).not.toContain(id);
      }
      expect(allModelOptions).toContain("openai/gpt-5.5-pro");
    });
  });

  describe("when an id is checked on its own", () => {
    /** @scenario A tiered pro serving mode OpenAI does not serve is not offered */
    it("reads only the OpenAI tiered pro shape as unserved", () => {
      expect(isPickableCatalogModel("openai/gpt-6-astra-pro")).toBe(false);
      expect(isPickableCatalogModel("openai/gpt-5.4-pro")).toBe(true);
      expect(isPickableCatalogModel("openai/gpt-6-astra")).toBe(true);
      expect(isPickableCatalogModel("moonshotai/kimi-k3.1-pro")).toBe(true);
    });
  });
});
