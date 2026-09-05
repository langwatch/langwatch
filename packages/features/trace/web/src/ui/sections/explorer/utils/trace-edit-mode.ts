import {
  isUneditableViewMode,
  selectIsTraceEditDirty,
  useDrawerStore,
  useTraceEditStore,
} from "../../../../index";

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
  openDrawer: (name: "traceV2Details", params: Record<string, unknown>) => void;
  traceId: string;
  occurredAtMs: number | null;
}): void {
  const openEditor = () => {
    const drawer = useDrawerStore.getState();
    if (drawer.viewMode === "conversation") {
      drawer.setViewModeTransient("summary");
    }
    if (drawer.isOpen) seedOpenDrawerForEdit({ traceId, occurredAtMs });
    openDrawer("traceV2Details", {
      traceId,
      ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
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

/** Moves the on-screen drawer onto the trace, editing, before the URL follows. */
function seedOpenDrawerForEdit({
  traceId,
  occurredAtMs,
}: {
  traceId: string;
  occurredAtMs: number | null;
}): void {
  const drawer = useDrawerStore.getState();
  if (drawer.traceId !== traceId) {
    drawer.openTrace(traceId, occurredAtMs);
  }
  if (useTraceEditStore.getState().editingTraceId !== traceId) {
    enterTraceEditMode(traceId);
  } else {
    // Re-entering the trace already being corrected: the session and its
    // drafts stay, only the mode bit is re-asserted.
    useDrawerStore.getState().setIsEditing(true);
  }
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
  if (!useDrawerStore.getState().isEditing || !selectIsTraceEditDirty(editStore)) {
    run();
    return true;
  }
  editStore.requestExit(run);
  return false;
}
