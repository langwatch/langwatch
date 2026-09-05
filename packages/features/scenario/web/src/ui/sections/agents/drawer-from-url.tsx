/**
 * URL-state wrappers for the three agent editor drawers that the drawer registry mounts when
 * `?drawer.open=agent{Http,Code}Editor` or `?drawer.open=workflowSelector` is present.
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { useDrawer } from "@langwatch/ui-drawer";
import { AgentCodeEditorDrawer, type AgentCodeEditorDrawerProps } from "./agent-code-editor-drawer";
import { AgentHttpEditorDrawer, type AgentHttpEditorDrawerProps } from "./agent-http-editor-drawer";
import {
  WorkflowSelectorDrawer,
  type WorkflowSelectorDrawerProps,
} from "./workflow-selector-drawer";

export function AgentCodeEditorDrawerFromUrl(
  props: Omit<AgentCodeEditorDrawerProps, "open"> & { open?: boolean },
) {
  const { drawerOpen } = useDrawer();
  const open = props.open ?? drawerOpen("agentCodeEditor");
  return <AgentCodeEditorDrawer {...props} open={open} />;
}

export function AgentHttpEditorDrawerFromUrl(props: AgentHttpEditorDrawerProps) {
  const { drawerOpen } = useDrawer();
  const open = props.open ?? drawerOpen("agentHttpEditor");
  return <AgentHttpEditorDrawer {...props} open={open} />;
}

export function WorkflowSelectorDrawerFromUrl(
  props: Omit<WorkflowSelectorDrawerProps, "open"> & { open?: boolean },
) {
  const { drawerOpen } = useDrawer();
  const open = props.open ?? drawerOpen("workflowSelector");
  return <WorkflowSelectorDrawer {...props} open={open} />;
}
