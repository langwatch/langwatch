import { getTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../../../../behavior/trace-edit.store.ts";
import { isUneditableViewMode, TRACE_DRAWER_NAME } from "../../../../model/trace-drawer-params.ts";

/**
 * Starts correcting a trace: the drawer flips into edit mode (which the URL
 * mirrors) and the draft opens on that trace. Kept as one call so the mode bit
 * and the draft can never disagree about which trace is being edited.
 */
export function enterTraceEditMode(traceId: string): void {
  const drawer = getTraceDrawer();
  if (isUneditableViewMode(drawer.viewMode)) {
    // Transient: the reviewer did not choose the Trace view, so it must not
    // become the tab they land on for every trace afterwards.
    drawer.setViewModeTransient("trace");
  }
  useTraceEditStore.getState().startEditing({ traceId });
  drawer.setIsEditing(true);
}

/**
 * A trace timestamp is only useful to the drawer when it is a real number: it
 * is a hint about which partition the trace lives in, and a missing one is
 * better left out than sent as "NaN".
 */
export function tracePartitionHint(startedAt: unknown): number | null {
  return typeof startedAt === "number" && Number.isFinite(startedAt) ? startedAt : null;
}

/**
 * Opens a turn's trace in the drawer, ready to be corrected.
 */
export function openTraceEditorFromConversation({
  openDrawer,
  traceId,
  occurredAtMs,
}: {
  openDrawer: (name: typeof TRACE_DRAWER_NAME, params: Record<string, unknown>) => void;
  traceId: string;
  occurredAtMs: number | null;
}): void {
  const openEditor = () => {
    // Opening a trace from the conversation view lands on its summary, for this one trace.
    const leavesConversation = getTraceDrawer().viewMode === "conversation";
    openDrawer(TRACE_DRAWER_NAME, {
      traceId,
      ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
      ...(leavesConversation ? { mode: "summary" } : {}),
      urlParams: { edit: "1" },
    });
  };
  // Editing another turn's trace leaves the current correction behind, so an
  // unsaved one asks first, like every other way out of the editor. The trace
  // already being corrected has nothing to lose and re-opens directly.
  if (useTraceEditStore.getState().editingTraceId === traceId) {
    openEditor();
  } else {
    guardTraceEditExit(openEditor);
  }
}

/** Leaves edit mode and drops the uncommitted correction. */
export function exitTraceEditMode(): void {
  useTraceEditStore.getState().discard();
  getTraceDrawer().setIsEditing(false);
}

/**
 * Runs something that would leave the trace behind, unless there is unsaved
 * work, in which case the action is parked and the reviewer is asked first.
 * Returns whether it ran, so a caller that has more to do can stop as well.
 */
export function guardTraceEditExit(run: () => void): boolean {
  const editStore = useTraceEditStore.getState();
  const hasUnsavedEdits = getTraceDrawer().isEditing && selectIsTraceEditDirty(editStore);
  if (!hasUnsavedEdits) {
    run();
    return true;
  }
  editStore.requestExit(run);
  return false;
}
