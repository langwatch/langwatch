/**
 * The eleven overlays that run on the SCENARIO host, mounted in it.
 *
 * WHY THE SIX AGENT EDITORS ARE HERE RATHER THAN UNDER `features/agent`. Three
 * of them — `agentCodeEditor`, `workflowSelector` and `agentHttpEditor` — are
 * the addresses `agentTypeSelector` writes, and that selector is the agent
 * family's. But what decides where a drawer is MOUNTED is which host it reads,
 * which is the rule `studio-host-drawers.tsx` states for the six it holds:
 * every one of these reads `@langwatch/scenario-web`'s own
 * `useOrganizationTeamProject` and its `agents.*` transport, so they are
 * mounted where that host is. The agent family keeps the address it writes and
 * nothing else.
 *
 * The other three arrive with them because they are the same host and the same
 * package: the studio's agent picker and the Evaluations table open
 * `agentList`, the Experiments workbench opens `agentWorkflowTargetEditor`, and
 * Agent Testing opens `agentTestingPlanEditor`.
 *
 * THE FIVE BELOW THEM WERE REGISTERED WITHOUT A HOST, AND THAT IS A CRASH
 * RATHER THAN A COSMETIC GAP. `scenarioRunDetail`, `scenarioEditor`,
 * `suiteEditor`, `agentWorkflowEditor` and `scenarioVersionHistory` were
 * registered straight off `@langwatch/scenario-web/drawers` before the agent
 * six existed. Every one of them reads the same host the six do —
 * `AgentWorkflowEditorDrawer` and `SuiteFormDrawer` call
 * `useOrganizationTeamProject` on their first render, and `useScenarioHost`
 * THROWS without a `ScenarioHostProvider`. `CurrentDrawer`'s error boundary
 * catches the throw, clears `?drawer.open=` and renders nothing, so the defect
 * presents as the same silent non-opening the census names: the reader clicks
 * and the page does not move.
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
  AgentWorkflowEditorDrawer as AgentWorkflowEditor,
  AgentWorkflowTargetEditorDrawer as AgentWorkflowTargetEditor,
  ScenarioFormDrawerFromUrl,
  ScenarioRunDetailDrawer as ScenarioRunDetail,
  ScenarioVersionHistoryDrawer as ScenarioVersionHistory,
  SuiteFormDrawer as SuiteForm,
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

/**
 * The five the family already served, now mounted in the host they read.
 *
 * Four of them declare `open?: boolean`, so they take the same address coercion
 * the agent editors do: `CurrentDrawer` spreads the PARSED address, and the
 * `open` a drawer receives is the drawer NAME. Each of the four survives the
 * string on its own — `!!open`, or `open !== false && open !== undefined` — but
 * a drawer whose declared prop is a boolean should be handed a boolean, and
 * saying so here is what keeps the next Chakra-facing edit inside one of them
 * from becoming the defect `ui-drawer-address.tsx` records.
 *
 * `suiteEditor` is the exception and takes no wrapper: `SuiteFormDrawer`
 * declares no `open` at all and asks the navigator `drawerOpen("suiteEditor")`
 * itself, exactly as the run plan editor above does.
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
