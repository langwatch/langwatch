/**
 * The six agent overlays that run on the SCENARIO host, mounted in it.
 *
 * WHY THEY ARE HERE RATHER THAN UNDER `features/agent`. Three of them —
 * `agentCodeEditor`, `workflowSelector` and `agentHttpEditor` — are the
 * addresses `agentTypeSelector` writes, and that selector is the agent family's.
 * But what decides where a drawer is MOUNTED is which host it reads, which is
 * the rule `studio-host-drawers.tsx` states for the six it holds: every one of
 * these reads `@langwatch/scenario-web`'s own `useOrganizationTeamProject` and
 * its `agents.*` transport, so they are mounted where that host is. The agent
 * family keeps the address it writes and nothing else.
 *
 * The other three arrive with them because they are the same host and the same
 * package: the studio's agent picker and the Evaluations table open
 * `agentList`, the Experiments workbench opens `agentWorkflowTargetEditor`, and
 * Agent Testing opens `agentTestingPlanEditor`.
 *
 * THE HOST TRAVELS WITH THE DRAWER, not with the address. `CurrentDrawer` is
 * mounted above the outlet, so a reader who opens one of these from a workflow,
 * a trace or the command palette is outside every provider the page below
 * brought — which is why each is wrapped here rather than relying on a
 * simulations page being underneath. `withScenarioDrawerHost` is the page
 * wrapper minus the module-scope failure host; its own comment says why.
 */

import {
  AgentCodeEditorDrawerFromUrl,
  AgentHttpEditorDrawerFromUrl,
  AgentListDrawer as AgentList,
  AgentTestingPlanEditorDrawer as AgentTestingPlanEditor,
  AgentWorkflowTargetEditorDrawer as AgentWorkflowTargetEditor,
  WorkflowSelectorDrawerFromUrl,
} from "@langwatch/scenario-web/drawers";

import { fromDrawerAddress } from "../../../drawers";
import { withScenarioDrawerHost } from "./host-provider";

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

/**
 * The run plan editor, which reads its own open state.
 *
 * It is a centred dialog rather than a side drawer, and it asks the navigator
 * `drawerOpen("agentTestingPlanEditor")` instead of taking an `open` prop —
 * so it is the one entry here with nothing to coerce.
 */
export const AgentTestingPlanEditorDrawer = withScenarioDrawerHost(AgentTestingPlanEditor);
