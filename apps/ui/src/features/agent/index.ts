/** Agents: screen, three dialogs and two overlays, all in `@langwatch/agent-web`. */

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
