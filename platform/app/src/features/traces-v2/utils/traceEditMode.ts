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

/**
 * A trace timestamp is only useful to the drawer when it is a real number: it
 * is a hint about which partition the trace lives in, and a missing one is
 * better left out than sent as "NaN".
 */
export function tracePartitionHint(startedAt: unknown): number | null {
  return typeof startedAt === "number" && Number.isFinite(startedAt)
    ? startedAt
    : null;
}

/**
 * Opens a turn's trace in the drawer, ready to be corrected.
 *
 * The conversation is a thread of traces, and a correction is about one of
 * them, so the drawer lands on that trace's own summary rather than on the
 * thread the reviewer just came from. Transiently, because reading a
 * conversation is not a decision to stop reading conversations.
 *
 * The link states the whole intent (which trace, and that it opens for
 * editing) and the drawer's URL hydrator opens it. Seeding the drawer store
 * instead would mount the drawer a frame before the URL names it, and the
 * hydrator reads that frame as "the URL has no drawer, close it".
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
  const drawer = useDrawerStore.getState();
  if (drawer.viewMode === "conversation") {
    drawer.setViewModeTransient("summary");
  }
  openDrawer("traceV2Details", {
    traceId,
    ...(occurredAtMs === null ? {} : { t: String(occurredAtMs) }),
    urlParams: { edit: "1" },
  });
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
