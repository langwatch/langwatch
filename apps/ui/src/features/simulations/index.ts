/**
 * The Simulations family, as this application composes it.
 *
 * The run board, the Scenario Library and Agent Testing — one product surface
 * over one transport — live in `@langwatch/scenario-web`; what belongs to the
 * application is everything they are not allowed to own: which page key an
 * address answers, the permission and release policy in front of it, the
 * transport their hooks run on, the host port that turns this application's
 * capabilities into the questions the family asks, and the overlays it opens.
 */

import { scenarioApi } from "@langwatch/scenario-web/screens/simulations";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";

import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { simulationsPageLoaders } from "./ui/sections/routes";

export const simulationsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/scenario-web",
  api: scenarioApi,
});

/**
 * The drawers this family serves, by the name the address uses.
 *
 * Every one of these opened nothing on a package-served page until the chrome
 * layout route mounted `CurrentDrawer`; that gap is closed, and these are the
 * addresses this family writes. `agentTypeSelector` is `@langwatch/agent-web`'s
 * and is registered there.
 */
export const simulationsDrawers: UiDrawerRegistry = {
  scenarioRunDetail: lazyDrawer({
    factory: () => import("@langwatch/scenario-web/drawers"),
    key: "ScenarioRunDetailDrawer",
  }),
  scenarioEditor: lazyDrawer({
    factory: () => import("@langwatch/scenario-web/drawers"),
    key: "ScenarioFormDrawerFromUrl",
  }),
  suiteEditor: lazyDrawer({
    factory: () => import("@langwatch/scenario-web/drawers"),
    key: "SuiteFormDrawer",
  }),
  scenarioVersionHistory: lazyDrawer({
    factory: () => import("@langwatch/scenario-web/drawers"),
    key: "ScenarioVersionHistoryDrawer",
  }),
  agentWorkflowEditor: lazyDrawer({
    factory: () => import("@langwatch/scenario-web/drawers"),
    key: "AgentWorkflowEditorDrawer",
  }),
};

export { simulationsPageLoaders };
