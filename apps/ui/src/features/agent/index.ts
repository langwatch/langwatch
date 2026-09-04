/** Agents: screen, three dialogs and two overlays, all in `@langwatch/agent-web`. */

import { agentApi } from "@langwatch/agent-web/screens/agent-management";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { agentPageLoaders } from "./ui/sections/agent-routes";

export const agentFeature = uiFeature({
  name: "@langwatch/agent-web",
  api: agentApi,
  loaders: agentPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    agentTypeSelector: lazyDrawer({
      factory: () => import("./ui/sections/agent-drawers"),
      key: "AgentTypeSelectorDrawer",
    }),
  },
});
