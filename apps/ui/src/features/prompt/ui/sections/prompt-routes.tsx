/**
 * Which page key the Prompt Studio address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/[project]/prompts`, and it is
 * kept rather than renamed: the route transcript in `apps/ui/tests/fixtures` is
 * the parity bar for the URL surface and fails the moment a page key changes,
 * so renaming one would spend that guard's signal on a cosmetic edit.
 *
 * `withPermissionGuard("prompts:view")`, unchanged from the platform page.
 */

import { promptScreens } from "@langwatch/prompt-web/screens/prompt-studio";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { PromptHost } from "./prompt-host";

/** The grant `platform/app`'s page carried, unchanged. */
const PROMPT_PAGE_PERMISSION = "prompts:view";

export const promptPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/prompts": uiPage({
    screen: async () => ({ default: (await promptScreens.promptStudio()).default as ComponentType }),
    host: PromptHost,
    permission: PROMPT_PAGE_PERMISSION,
  }),
};
