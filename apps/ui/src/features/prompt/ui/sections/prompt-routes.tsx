/** Which page key the Prompt Studio address answers: `prompts:view`, unchanged from the platform page. */

import { promptScreens } from "@langwatch/prompt-web/screens/prompt-studio";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { PromptHost } from "./prompt-host";

/** The grant `platform/app`'s page carried, unchanged. */
const PROMPT_PAGE_PERMISSION = "prompts:view";

export const promptPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/prompts": uiPage({
    screen: async () => ({
      default: (await promptScreens.promptStudio()).default as ComponentType,
    }),
    host: PromptHost,
    permission: PROMPT_PAGE_PERMISSION,
  }),
};
