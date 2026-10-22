import { createDesignSystem } from "@langwatch/design-system/system";
import { describe, expect, it } from "vitest";

import { docsMenuSystem, docsSearchSystem } from "../island-theme.ts";
import { docsTheme } from "../theme-config.ts";

const docsSystem = createDesignSystem(docsTheme);

const ISLANDS = [
  { name: "context menus", system: docsMenuSystem, recipes: ["button"], slotRecipes: ["menu"] },
  {
    name: "search",
    system: docsSearchSystem,
    recipes: ["button", "input", "spinner"],
    slotRecipes: ["dialog"],
  },
];

describe.each(ISLANDS)(
  "when the $name island styles itself",
  ({ system, recipes, slotRecipes }) => {
    it("writes the same docs tokens and global styles as the prerendered page", () => {
      expect(system.getTokenCss()).toEqual(docsSystem.getTokenCss());
      expect(system.getGlobalCss()).toEqual(docsSystem.getGlobalCss());
      expect(system.getPreflightCss()).toEqual(docsSystem.getPreflightCss());
    });

    it("styles every recipe it renders exactly as the prerendered page does", () => {
      for (const key of recipes) expect(system.getRecipe(key)).toEqual(docsSystem.getRecipe(key));
      for (const key of slotRecipes) {
        expect(system.getSlotRecipe(key)).toEqual(docsSystem.getSlotRecipe(key));
      }
    });
  },
);
