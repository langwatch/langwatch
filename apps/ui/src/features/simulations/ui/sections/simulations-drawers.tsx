/**
 * The eleven overlays on the scenario host, mounted here (mounting follows
 * which host a drawer reads). Every one MUST stay wrapped in
 * `withScenarioDrawerHost` — unwrapped, `useScenarioHost` throws.
 */

import {
  AgentTestingCaseEditorDrawer as AgentTestingCaseEditor,
  ScenarioFormDrawerFromUrl,
  ScenarioRunDetailDrawer as ScenarioRunDetail,
  ScenarioVersionHistoryDrawer as ScenarioVersionHistory,
  SuiteFormDrawer as SuiteForm,
} from "@langwatch/scenario-web/drawers";

import { fromDrawerAddress } from "../../../../model/ui-drawer-address";
import { withScenarioDrawerHost } from "./host";
import {
  ConnectedAgentDrawer as ConnectedAgent,
  ConnectFromCodeDrawer as ConnectFromCode,
} from "./connected-agent-drawers";
import { AgentCodeEditorDrawer as CodeEditor } from "./agent-code-drawer";
import { AgentHttpEditorDrawer as HttpEditor } from "./agent-http-drawer";
import { AgentListDrawer as AgentList } from "./agent-list-drawer";
import {
  AgentWorkflowEditorDrawer as AgentWorkflowEditor,
  AgentWorkflowTargetEditorDrawer as AgentWorkflowTargetEditor,
} from "./agent-workflow-drawers";
import { WorkflowSelectorDrawer as WorkflowSelector } from "./workflow-selector-drawer";

export const AgentCodeEditorDrawer = withScenarioDrawerHost(fromDrawerAddress(CodeEditor));
export const AgentHttpEditorDrawer = withScenarioDrawerHost(fromDrawerAddress(HttpEditor));
export const WorkflowSelectorDrawer = withScenarioDrawerHost(fromDrawerAddress(WorkflowSelector));
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
export const SuiteEditorDrawer = withScenarioDrawerHost((props: { suiteId?: string }) => (
  <SuiteForm {...props} renderHttpEditor={(editor) => <HttpEditor {...editor} />} />
));
export const AgentWorkflowEditorDrawer = withScenarioDrawerHost(
  fromDrawerAddress(AgentWorkflowEditor),
);
export const ScenarioVersionHistoryDrawer = withScenarioDrawerHost(
  fromDrawerAddress(ScenarioVersionHistory),
);
