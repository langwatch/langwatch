/**
 * The eleven overlays on the scenario host, mounted here (mounting follows
 * which host a drawer reads). Every one MUST stay wrapped in
 * `withScenarioDrawerHost` — unwrapped, `useScenarioHost` throws.
 */

import {
  AgentCodeEditorDrawerFromUrl,
  AgentHttpEditorDrawerFromUrl,
  AgentListDrawer as AgentList,
  AgentTestingCaseEditorDrawer as AgentTestingCaseEditor,
  AgentWorkflowEditorDrawer as AgentWorkflowEditor,
  AgentWorkflowTargetEditorDrawer as AgentWorkflowTargetEditor,
  ConnectedAgentDrawer as ConnectedAgent,
  ConnectFromCodeDrawer as ConnectFromCode,
  ScenarioFormDrawerFromUrl,
  ScenarioRunDetailDrawer as ScenarioRunDetail,
  ScenarioVersionHistoryDrawer as ScenarioVersionHistory,
  SuiteFormDrawer as SuiteForm,
  WorkflowSelectorDrawerFromUrl,
} from "@langwatch/scenario-web/drawers";

import { fromDrawerAddress } from "../../../drawers";
import { withScenarioDrawerHost } from "./host";

export const AgentCodeEditorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(AgentCodeEditorDrawerFromUrl),
);
export const AgentHttpEditorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(AgentHttpEditorDrawerFromUrl),
);
export const WorkflowSelectorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(WorkflowSelectorDrawerFromUrl),
);
export const AgentListDrawer = withScenarioDrawerHost(fromDrawerAddress(AgentList));
export const AgentWorkflowTargetEditorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(AgentWorkflowTargetEditor),
);

/** Reads its own open state via `drawerOpen("agentTestingCaseEditor")` rather than an `open` prop, so nothing here needs coercing. */
export const AgentTestingCaseEditorDrawer = withScenarioDrawerHost(AgentTestingCaseEditor);

/**
 * The connected-agent pair. `agentConnectedDetail` reads the agent id off the
 * address itself and takes no `open`, so it needs no coercion; the code-snippet
 * drawer declares `open?: boolean` and takes the same one the editors take.
 */
export const ConnectedAgentDetailDrawer = withScenarioDrawerHost(ConnectedAgent);
export const ConnectFromCodeDrawer = withScenarioDrawerHost(fromDrawerAddress(ConnectFromCode));

/**
 * The five the family already served. Four declare `open?: boolean` and
 * take `fromDrawerAddress`'s coercion (see its docstring); `suiteEditor` is
 * the exception, reading its own state via `drawerOpen("suiteEditor")`.
 */
export const ScenarioRunDetailDrawer = withScenarioDrawerHost(fromDrawerAddress(ScenarioRunDetail));
export const ScenarioEditorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(ScenarioFormDrawerFromUrl),
);
export const SuiteEditorDrawer = withScenarioDrawerHost(SuiteForm);
export const AgentWorkflowEditorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(AgentWorkflowEditor),
);
export const ScenarioVersionHistoryDrawer = withScenarioDrawerHost(
  fromDrawerAddress(ScenarioVersionHistory),
);
