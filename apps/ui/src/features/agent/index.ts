/**
 * The Agents family, as this application composes it.
 *
 * The screen, its three dialogs and its two overlays live in
 * `@langwatch/agent-web`; what belongs to the application is everything they are
 * not allowed to own — which page key the address answers, the permission policy
 * in front of it, the transport their hooks run on, and the host port that turns
 * this application's capabilities into the questions the family asks.
 */

import { agentApi } from "@langwatch/agent-web/screens/agent-management";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { agentPageLoaders } from "./ui/sections/agent-routes";

export const agentApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/agent-web",
  api: agentApi,
});

export { agentPageLoaders };
