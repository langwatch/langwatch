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

export { ScenarioRunDetailDrawer } from "../components/simulations/scenario-run-detail-drawer";
export { ScenarioFormDrawerFromUrl } from "../components/scenarios/scenario-form-drawer";
export { SuiteFormDrawer } from "../components/suites/suite-form-drawer";
export { AgentWorkflowEditorDrawer } from "../components/agents/agent-workflow-editor-drawer";
export { ScenarioVersionHistoryDrawer } from "../components/agent-testing/drawers/scenario-version-history-drawer";
