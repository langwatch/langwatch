/** Prompts: Prompt Studio's tabbed browser, chat, sidebar and six dialogs, all in `@langwatch/prompt-web`. */

import { promptApi } from "@langwatch/prompt-web/screens/prompt-studio";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { promptPageLoaders } from "./ui/sections/prompt-routes";

export const promptFeature = uiFeature({
  name: "@langwatch/prompt-web",
  api: promptApi,
  loaders: promptPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    promptList: lazyDrawer({
      factory: () => import("./ui/sections/prompt-drawers"),
      key: "PromptListDrawer",
    }),
  },
});
