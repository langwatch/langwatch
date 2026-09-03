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
 *
 * EVERY ONE OF THEM IS WRAPPED IN THIS FAMILY'S HOST before it is registered,
 * because `CurrentDrawer` is mounted above the outlet and a drawer opened from
 * a workflow or the command palette renders outside whatever provider the page
 * below it brought. The five above the agent editors were registered straight
 * off the package for a while, and `agentWorkflowEditor` and `suiteEditor` both
 * THREW on mount for want of the provider — swallowed by the drawer host's
 * error boundary, so it read as the same silent non-opening. See
 * `ui/sections/simulations-drawers.tsx` for the whole argument.
 */
export const simulationsDrawers: UiDrawerRegistry = {
  scenarioRunDetail: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "ScenarioRunDetailDrawer",
  }),
  scenarioEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "ScenarioEditorDrawer",
  }),
  suiteEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "SuiteEditorDrawer",
  }),
  scenarioVersionHistory: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "ScenarioVersionHistoryDrawer",
  }),
  agentWorkflowEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentWorkflowEditorDrawer",
  }),
  agentCodeEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentCodeEditorDrawer",
  }),
  agentHttpEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentHttpEditorDrawer",
  }),
  workflowSelector: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "WorkflowSelectorDrawer",
  }),
  agentList: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentListDrawer",
  }),
  agentWorkflowTargetEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentWorkflowTargetEditorDrawer",
  }),
  agentTestingPlanEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentTestingPlanEditorDrawer",
  }),
};

export { simulationsPageLoaders };
