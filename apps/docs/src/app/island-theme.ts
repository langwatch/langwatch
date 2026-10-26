import {
  buttonSelection,
  createSelectedDesignSystem,
  menuSelection,
} from "@langwatch/design-system/selected-system";

import { docsTheme } from "./theme-config.ts";

/* Each island builds the docs theme with only the recipes it renders, so the context menus never
   download styles they do not render; a test guards the list. */

/** The page and theme menus: icon buttons and menus. */
export const docsMenuSystem = createSelectedDesignSystem({
  recipes: { button: buttonSelection },
  slotRecipes: { menu: menuSelection },
  extensions: [docsTheme],
});

