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
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { agentPageLoaders } from "./ui/sections/agent-routes";

export const agentApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/agent-web",
  api: agentApi,
});

/** The drawers this family serves, by the name the address uses. */
export const agentDrawers: UiDrawerRegistry = {
  agentTypeSelector: lazyDrawer({
    factory: () => import("./ui/sections/agent-drawers"),
    key: "AgentTypeSelectorDrawer",
  }),
};

export { agentPageLoaders };
