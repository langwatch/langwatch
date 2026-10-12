import { createDesignSystem } from "@langwatch/design-system/system";
import { describe, expect, it } from "vitest";

import { docsIslandSystem } from "../island-theme.ts";
import { docsTheme } from "../theme-config.ts";

const docsSystem = createDesignSystem(docsTheme);

const RECIPES = ["button", "input", "spinner"];
const SLOT_RECIPES = ["dialog", "menu"];

describe("when the menus and search islands style themselves", () => {
  it("write the same docs tokens and global styles as the prerendered page", () => {
    expect(docsIslandSystem.getTokenCss()).toEqual(docsSystem.getTokenCss());
    expect(docsIslandSystem.getGlobalCss()).toEqual(docsSystem.getGlobalCss());
    expect(docsIslandSystem.getPreflightCss()).toEqual(docsSystem.getPreflightCss());
  });

  it("style every recipe they render exactly as the prerendered page does", () => {
    for (const key of RECIPES) {
      expect(docsIslandSystem.getRecipe(key)).toEqual(docsSystem.getRecipe(key));
    }
    for (const key of SLOT_RECIPES) {
      expect(docsIslandSystem.getSlotRecipe(key)).toEqual(docsSystem.getSlotRecipe(key));
    }
  });
});
