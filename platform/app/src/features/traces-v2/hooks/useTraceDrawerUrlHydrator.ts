import { useEffect, useRef } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { parseEditParam, useDrawerStore } from "../stores/drawerStore";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../stores/traceEditStore";
import { enterTraceEditMode, exitTraceEditMode } from "../utils/traceEditMode";

/**
 * One-way URL → drawer store sync. Lives at the page level so the
 * `<TraceV2DrawerShell>` mount decision can read the store directly
 * (synchronous on click) instead of waiting for the URL push to
 * round-trip through React Router. Deep links + browser back/forward
 * still feed the store via this hook.
 *
 * Without this, clicking a row had to wait for `router.push` to
 * complete before `CurrentDrawer` saw `drawer.open=traceV2Details`
 * and mounted the shell — visible as a beat between click and the
 * drawer sliding in. With the store as the source of truth and the
 * URL only a serialization, the shell can mount the same render the
 * click ran in.
 */
export function useTraceDrawerUrlHydrator(): void {
  const { currentDrawer, openDrawer, closeDrawer } = useDrawer();
  const params = useDrawerParams();
  // Held in a ref rather than as dependencies: both change identity with every
  // query change on the page, and this effect answers to the drawer parameters
  // alone.
  const drawerRef = useRef({ openDrawer, closeDrawer });
  drawerRef.current = { openDrawer, closeDrawer };

  useEffect(() => {
    const wantsOpen = currentDrawer === "traceV2Details";
    const traceId = params.traceId ?? null;
    const occurredAtMs = params.t ? Number(params.t) : null;
    const validTimestamp =
      occurredAtMs !== null && Number.isFinite(occurredAtMs) && occurredAtMs > 0
        ? occurredAtMs
        : null;

    const store = useDrawerStore.getState();

    if (wantsOpen && traceId) {
      const alreadyOnTrace =
        store.traceId === traceId && store.occurredAtMs === validTimestamp;
      if (!alreadyOnTrace) store.openTrace(traceId, validTimestamp);
      syncEditMode({
        traceId,
        editParam: params.edit,
        openDrawer: drawerRef.current.openDrawer,
      });
      return;
    }

    if (!wantsOpen && store.traceId) {
      if (keepDrawerForUnsavedEdit(drawerRef.current)) return;
      store.closeDrawer();
      exitTraceEditMode();
    }
  }, [currentDrawer, params.traceId, params.t, params.edit]);
}

/**
 * Browser history must not throw away work. A link from before the correction
 * was started says nothing about the correction, so following it back would
 * drop an unsaved one with no way to get it back.
 *
 * The reviewer is asked instead, and the question lives in the edit bar, which
 * only exists while the drawer is mounted — parking the exit on its own would
 * park it on a dialog that just unmounted. So the drawer's link is re-asserted
 * first, and the parked exit closes it for real once the reviewer says they are
 * done with the correction.
 *
 * Returns whether the close was held back.
 */
function keepDrawerForUnsavedEdit({
  openDrawer,
  closeDrawer,
}: Pick<ReturnType<typeof useDrawer>, "openDrawer" | "closeDrawer">): boolean {
  const editStore = useTraceEditStore.getState();
  const drawer = useDrawerStore.getState();
  const editingTraceId = editStore.editingTraceId;
  if (editingTraceId === null || editingTraceId !== drawer.traceId) {
    return false;
  }
  if (!selectIsTraceEditDirty(editStore)) return false;

  drawer.setIsEditing(true);
  openDrawer("traceV2Details", {
    traceId: editingTraceId,
    ...(drawer.occurredAtMs !== null ? { t: String(drawer.occurredAtMs) } : {}),
    urlParams: { edit: "1" },
  });
  editStore.requestExit(() => {
    useDrawerStore.getState().closeDrawer();
    exitTraceEditMode();
    // The link was put back to keep the drawer on screen for the question, so
    // taking the answer means taking it out again.
    closeDrawer();
  });
  return true;
}

/**
 * Brings the edit session in line with what the link asks for. The one case
 * that is not a straight assignment is browser history: going back to a URL
 * from before the reviewer started editing would drop an unsaved correction,
 * so a dirty session stays open and the URL sync re-asserts the parameter.
 */
function syncEditMode({
  traceId,
  editParam,
  openDrawer,
}: {
  traceId: string;
  editParam: string | undefined;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}): void {
  const wantsEdit = parseEditParam({ raw: editParam, traceId });
  const editStore = useTraceEditStore.getState();
  const editingTraceId = editStore.editingTraceId;

  if (wantsEdit) {
    // Starting over would drop the drafts, so only a different trace does that.
    // The drawer's own flag is asserted either way: opening a trace clears it,
    // and leaving it cleared would strip `drawer.edit` from a link that asks
    // for edit mode and take the drafts with it.
    if (editingTraceId !== traceId) enterTraceEditMode(traceId);
    else useDrawerStore.getState().setIsEditing(true);
    return;
  }

  if (editingTraceId === null) return;
  if (!selectIsTraceEditDirty(editStore)) {
    exitTraceEditMode();
    return;
  }
  // The correction stays, so the link has to say so. Leaving the URL without
  // `drawer.edit` would keep the edit bar on screen over a link that reads as
  // "not editing", and the next reload would take the work with it unasked.
  if (editingTraceId !== traceId) return;
  const drawer = useDrawerStore.getState();
  drawer.setIsEditing(true);
  openDrawer("traceV2Details", {
    traceId,
    ...(drawer.occurredAtMs !== null ? { t: String(drawer.occurredAtMs) } : {}),
    urlParams: { edit: "1" },
  });
}
