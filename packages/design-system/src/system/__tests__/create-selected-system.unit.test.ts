import { describe, expect, it } from "vitest";

import {
  buttonSelection,
  createSelectedDesignSystem,
  dialogSelection,
  menuSelection,
} from "../create-selected-system.ts";
import { createDesignSystem } from "../create-system.ts";

const extension = {
  theme: { semanticTokens: { colors: { brand: { value: { _light: "#fff", _dark: "#000" } } } } },
};
const full = createDesignSystem(extension);
const selected = createSelectedDesignSystem({
  recipes: { button: buttonSelection },
  slotRecipes: { dialog: dialogSelection, menu: menuSelection },
  extensions: [extension],
});

describe("when a surface builds a design system from selected recipes", () => {
  it("writes the same tokens, preflight and global styles as the full system", () => {
    expect(selected.getTokenCss()).toEqual(full.getTokenCss());
    expect(selected.getPreflightCss()).toEqual(full.getPreflightCss());
    expect(selected.getGlobalCss()).toEqual(full.getGlobalCss());
    expect(selected.token("colors.brand")).toEqual(full.token("colors.brand"));
  });

  it("styles each selected recipe exactly as the full system, overrides included", () => {
    expect(selected.getRecipe("button")).toEqual(full.getRecipe("button"));
    expect(selected.getSlotRecipe("dialog")).toEqual(full.getSlotRecipe("dialog"));
    expect(selected.getSlotRecipe("menu")).toEqual(full.getSlotRecipe("menu"));
    expect(selected.css({ textStyle: "sm", layerStyle: "fill.muted" })).toEqual(
      full.css({ textStyle: "sm", layerStyle: "fill.muted" }),
    );
  });

  it("leaves out every recipe it was not given", () => {
    expect(selected.isRecipe("badge")).toBe(false);
    expect(selected.isSlotRecipe("table")).toBe(false);
    expect(selected.isSlotRecipe("drawer")).toBe(false);
  });
});
