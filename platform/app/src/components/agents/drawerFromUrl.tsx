/**
 * URL-state wrappers for the three agent editor drawers that the drawer
 * registry mounts when `?drawer.open=agent{Http,Code}Editor` or
 * `?drawer.open=workflowSelector` is present.
 *
 * Without these wrappers `CurrentDrawer` would spread the URL-parsed
 * `drawer.*` object onto the drawer component, leaving `props.open` as
 * the drawer-name STRING. Each underlying drawer treats any defined
 * non-`false` `open` as "open", so the registry path technically works
 * — but Chakra/Zag drawers only accept a boolean `open`. The wrappers
 * coerce URL state into a proper boolean and pass it through.
 *
 * Mirrors the pre-existing `ScenarioFormDrawerFromUrl` pattern.
 *
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { useDrawer } from "~/hooks/useDrawer";
import {
  AgentCodeEditorDrawer,
  type AgentCodeEditorDrawerProps,
} from "./AgentCodeEditorDrawer";
import {
  AgentHttpEditorDrawer,
  type AgentHttpEditorDrawerProps,
} from "./AgentHttpEditorDrawer";
import {
  WorkflowSelectorDrawer,
  type WorkflowSelectorDrawerProps,
} from "./WorkflowSelectorDrawer";

export function AgentCodeEditorDrawerFromUrl(
  props: Omit<AgentCodeEditorDrawerProps, "open"> & { open?: boolean },
) {
  const { drawerOpen } = useDrawer();
  const open = props.open ?? drawerOpen("agentCodeEditor");
  return <AgentCodeEditorDrawer {...props} open={open} />;
}

export function AgentHttpEditorDrawerFromUrl(
  props: Omit<AgentHttpEditorDrawerProps, "open"> & { open?: boolean },
) {
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
