/** Simulations: the run board, Scenario Library and Agent Testing, one product surface over one transport, in `@langwatch/scenario-web`. */

import { scenarioApi } from "@langwatch/scenario-web/screens/simulations";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";

import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { simulationsPageLoaders } from "./ui/sections/routes";

export const simulationsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/scenario-web",
  api: scenarioApi,
});

/**
 * Every one wrapped in this family's host before registration — a drawer
 * opened from a workflow or the command palette renders outside whatever
 * provider the page below it brought. See `simulations-drawers.tsx`.
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
  agentTestingCaseEditor: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "AgentTestingCaseEditorDrawer",
  }),
  agentConnectedDetail: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "ConnectedAgentDetailDrawer",
  }),
  agentConnectFromCode: lazyDrawer({
    factory: () => import("./ui/sections/simulations-drawers"),
    key: "ConnectFromCodeDrawer",
  }),
};

export { simulationsPageLoaders };
