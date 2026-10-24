import {
  buttonSelection,
  createSelectedDesignSystem,
  dialogSelection,
  inputSelection,
  menuSelection,
  spinnerSelection,
} from "@langwatch/design-system/selected-system";

import { docsTheme } from "./theme-config.ts";

/* Each island builds the docs theme with only the recipes it renders, so the context menus never
   download the dialog's styles and search never downloads the menu's; a test guards both lists. */

/** The page and theme menus: icon buttons and menus. */
export const docsMenuSystem = createSelectedDesignSystem({
  recipes: { button: buttonSelection },
  slotRecipes: { menu: menuSelection },
  extensions: [docsTheme],
});

/** The search dialog: buttons, the query input, the loading spinner and the dialog. */
export const docsSearchSystem = createSelectedDesignSystem({
  recipes: { button: buttonSelection, input: inputSelection, spinner: spinnerSelection },
  slotRecipes: { dialog: dialogSelection },
  extensions: [docsTheme],
});
