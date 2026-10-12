import {
  buttonSelection,
  createSelectedDesignSystem,
  dialogSelection,
  inputSelection,
  menuSelection,
  spinnerSelection,
} from "@langwatch/design-system/selected-system";

import { docsTheme } from "./theme-config.ts";

/** The docs theme with only the recipes the menus and search render; a test guards the list. */
export const docsIslandSystem = createSelectedDesignSystem({
  recipes: { button: buttonSelection, input: inputSelection, spinner: spinnerSelection },
  slotRecipes: { dialog: dialogSelection, menu: menuSelection },
  extensions: [docsTheme],
});
