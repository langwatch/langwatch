/** Prompts: Prompt Studio's tabbed browser, chat, sidebar and six dialogs, all in `@langwatch/prompt-web`. */

import { promptApi } from "@langwatch/prompt-web/screens/prompt-studio";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { promptPageLoaders } from "./ui/sections/prompt-routes";

export const promptApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/prompt-web",
  api: promptApi,
});

/** The drawers this family serves, by the name the address uses. */
export const promptDrawers: UiDrawerRegistry = {
  promptList: lazyDrawer({
    factory: () => import("./ui/sections/prompt-drawers"),
    key: "PromptListDrawer",
  }),
};

export { promptPageLoaders };
