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
 */

export { ScenarioRunDetailDrawer } from "../components/simulations/ScenarioRunDetailDrawer";
export { ScenarioFormDrawerFromUrl } from "../components/scenarios/ScenarioFormDrawer";
export { SuiteFormDrawer } from "../components/suites/SuiteFormDrawer";
export { AgentWorkflowEditorDrawer } from "../components/agents/AgentWorkflowEditorDrawer";
export { ScenarioVersionHistoryDrawer } from "../components/agent-testing/drawers/ScenarioVersionHistoryDrawer";
