import { isUneditableViewMode, useDrawerStore } from "../stores/drawerStore";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../stores/traceEditStore";

/**
 * Starts correcting a trace: the drawer flips into edit mode (which the URL
 * mirrors) and the draft opens on that trace. Kept as one call so the mode bit
 * and the draft can never disagree about which trace is being edited.
 */
export function enterTraceEditMode(traceId: string): void {
  const drawer = useDrawerStore.getState();
  if (isUneditableViewMode(drawer.viewMode)) {
    // Transient: the reviewer did not choose the Trace view, so it must not
    // become the tab they land on for every trace afterwards.
    drawer.setViewModeTransient("trace");
  }
  useTraceEditStore.getState().startEditing({ traceId });
  drawer.setIsEditing(true);
}

/** Leaves edit mode and drops the uncommitted correction. */
export function exitTraceEditMode(): void {
  useTraceEditStore.getState().discard();
  useDrawerStore.getState().setIsEditing(false);
}

/**
 * Runs something that would leave the trace behind, unless there is unsaved
 * work, in which case the action is parked and the reviewer is asked first.
 * Returns whether it ran, so a caller that has more to do can stop as well.
 */
export function guardTraceEditExit(run: () => void): boolean {
  const editStore = useTraceEditStore.getState();
  if (
    !useDrawerStore.getState().isEditing ||
    !selectIsTraceEditDirty(editStore)
  ) {
    run();
    return true;
  }
  editStore.requestExit(run);
  return false;
}
