import { useDrawerStore } from "../stores/drawerStore";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../stores/traceEditStore";

/**
 * Views that replay an agent run rather than showing the trace's own spans.
 * There is nothing to correct in them, so entering edit mode moves the reader
 * to the Trace view first.
 */
const READ_ONLY_VIEW_MODES = new Set(["conversation", "terminal", "session"]);

/**
 * Starts correcting a trace: the drawer flips into edit mode (which the URL
 * mirrors) and the draft opens on that trace. Kept as one call so the mode bit
 * and the draft can never disagree about which trace is being edited.
 */
export function enterTraceEditMode(traceId: string): void {
  const drawer = useDrawerStore.getState();
  if (READ_ONLY_VIEW_MODES.has(drawer.viewMode)) {
    // Transient: the reviewer did not choose the Trace view, so it must not
    // become the tab they land on for every trace afterwards.
    drawer.setViewModeTransient("trace");
  }
  useTraceEditStore.getState().startEditing({ traceId });
  drawer.setEditing(true);
}

/** Leaves edit mode and drops the uncommitted correction. */
export function exitTraceEditMode(): void {
  useTraceEditStore.getState().discard();
  useDrawerStore.getState().setEditing(false);
}

/**
 * Runs something that would leave the trace behind, unless there is unsaved
 * work, in which case the action is parked and the reviewer is asked first.
 * Returns whether it ran, so a caller that has more to do can stop as well.
 */
export function guardTraceEditExit(run: () => void): boolean {
  const editStore = useTraceEditStore.getState();
  if (
    !useDrawerStore.getState().editing ||
    !selectIsTraceEditDirty(editStore)
  ) {
    run();
    return true;
  }
  editStore.requestExit(run);
  return false;
}
