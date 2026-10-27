import type { WorkbenchStateView } from "../../experiment-workbench-version.ts";
import {
  type ProjectedWorkbenchState,
  projectWorkbenchState,
  type TargetNames,
} from "./projection.ts";

/** What `workbench.getState` answers when no page is open: the saved board, or none saved yet. */
export type SavedWorkbenchRead =
  | { source: "saved"; version: number; state: null }
  | (ProjectedWorkbenchState & { source: "saved"; version: number });

/**
 * The saved workbench as the agent should read it. The snapshot has no transient run status, so
 * its results read as "idle".
 */
export const readSavedWorkbench = ({
  view,
  includeResults,
  targetNames,
}: {
  view: Pick<WorkbenchStateView, "state" | "version">;
  includeResults?: boolean;
  targetNames?: TargetNames;
}): SavedWorkbenchRead => {
  const saved = view.state;
  if (!saved) return { source: "saved", version: view.version, state: null };
  const persisted = includeResults === false ? undefined : saved.results;
  const projection = projectWorkbenchState({
    state: saved,
    ...(targetNames ? { targetNames } : {}),
    ...(persisted ? { results: { status: "idle", ...persisted } } : {}),
  });
  return { source: "saved", version: view.version, ...projection };
};
