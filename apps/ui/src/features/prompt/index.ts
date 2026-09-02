/**
 * The Prompts family, as this application composes it.
 *
 * Prompt Studio — the tabbed browser, the chat, the sidebar and its six
 * dialogs — lives in `@langwatch/prompt-web`; what belongs to the application
 * is everything it is not allowed to own: which page key the address answers,
 * the permission policy in front of it, the transport its hooks run on, and the
 * host port that turns this application's capabilities into the questions the
 * family asks.
 */

import { promptApi } from "@langwatch/prompt-web/screens/prompt-studio";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { promptPageLoaders } from "./ui/sections/prompt-routes";

export const promptApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/prompt-web",
  api: promptApi,
});

export { promptPageLoaders };
