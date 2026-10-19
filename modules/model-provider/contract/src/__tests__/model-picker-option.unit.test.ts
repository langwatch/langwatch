import { describe, expect, it } from "vitest";

import { modelPickerOption } from "../model-options.ts";

const DISPLAY_NAMES = {
  "custom/gpt-5.1": "Ada Prod Model",
  "custom/text-embed-3": "Ada Prod Embed",
};

describe("modelPickerOption()", () => {
  describe("given a custom model with a configured display name", () => {
    it("labels it with the display name and picks the model id", () => {
      expect(
        modelPickerOption({ displayNames: DISPLAY_NAMES, modelValue: "custom/gpt-5.1" }),
      ).toMatchObject({
        label: "Ada Prod Model",
        value: "custom/gpt-5.1",
      });
    });

    it("labels an embeddings model by its display name too", () => {
      expect(
        modelPickerOption({ displayNames: DISPLAY_NAMES, modelValue: "custom/text-embed-3" }).label,
      ).toBe("Ada Prod Embed");
    });
  });

  describe("given a registry model without a display name", () => {
    it("keeps the id-derived label", () => {
      expect(
        modelPickerOption({ displayNames: DISPLAY_NAMES, modelValue: "custom/gpt-4o-mini" }).label,
      ).toBe("gpt-4o-mini");
    });
  });

  describe("given a latest alias", () => {
    it("reads as Latest with the resolved model as the subtitle", () => {
      const option = modelPickerOption({ displayNames: undefined, modelValue: "openai/latest" });

      expect(option.label).toBe("Latest");
      expect(option.subtitle).toBeTruthy();
    });

    it("reads the mini alias as the smaller model", () => {
      expect(
        modelPickerOption({ displayNames: undefined, modelValue: "openai/latest-mini" }).label,
      ).toBe("Latest smaller model");
    });
  });
});
