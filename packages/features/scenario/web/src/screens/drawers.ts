/**
 * The overlays this family owns, by the name the address uses.
 *
 * `?drawer.open=scenarioRunDetail` and the four editors below are addresses,
 * not components: `@langwatch/ui-drawer` owns the vocabulary and the
 * composing application installs one registry out of every family's map. This
 * module is what that application lazily imports, so none of these components
 * are in the bundle until a reader opens one.
 *
 * `agentTypeSelector` is NOT here. It is `@langwatch/agent-web`'s, already
 * registered, and this family only ever writes its address.
 *
 * THE SIX AGENT OVERLAYS BELOW WERE ADDRESSED AND UNPUBLISHED. Every one of
 * them is opened by name — the type selector leads to three of them, the studio
 * agent picker and the Evaluations table open `agentList`, the Experiments
 * target editor opens `agentWorkflowTargetEditor`, and Agent Testing opens
 * `agentTestingCaseEditor` — and none of them was exported, so the composing
 * application could not register the name and `CurrentDrawer` rendered null.
 * They are components here like the five above: what decides the boolean `open`
 * and which host they are mounted in is the application's, not this module's.
 */

export { ScenarioRunDetailDrawer } from "../ui/sections/simulations/scenario-run-detail-drawer";
export { ScenarioFormDrawerFromUrl } from "../ui/sections/scenarios/scenario-form-drawer";
export { SuiteFormDrawer } from "../ui/sections/suites/suite-form-drawer";
export { AgentWorkflowEditorDrawer } from "../ui/sections/agents/agent-workflow-editor-drawer";
export { ScenarioVersionHistoryDrawer } from "../ui/sections/agent-testing/drawers/scenario-version-history-drawer";
export {
  AgentCodeEditorDrawerFromUrl,
  AgentHttpEditorDrawerFromUrl,
  WorkflowSelectorDrawerFromUrl,
} from "../ui/sections/agents/drawer-from-url";
export { AgentListDrawer } from "../ui/sections/agents/agent-list-drawer";
export { AgentWorkflowTargetEditorDrawer } from "../ui/sections/agents/agent-workflow-target-editor-drawer";
export { AgentTestingCaseEditorDrawer } from "../ui/sections/agent-testing/cases/agent-testing-case-editor-drawer";
export { ConnectedAgentDrawer } from "../ui/sections/agents/connected/connected-agent-drawer";
export { ConnectFromCodeDrawer } from "../ui/sections/agents/connected/connect-from-code-drawer";
