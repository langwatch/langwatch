import { useEffect } from "react";

import { useTraceEditOverlay } from "../../../../behavior/explorer/use-trace-edit-overlay.ts";
import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../../../../features/trace-drawer/behavior/trace-edit.store.ts";

/**
 * Keeps an editing session honest for as long as it is open:
 */
export function useTraceEditSession(traceId: string | undefined): void {
  const isEditing = useTraceDrawer((s) => s.isEditing);
  const overlay = useTraceEditOverlay();
  const overlayPatch = overlay.data?.patch;

  useEffect(() => {
    if (!isEditing || !traceId || !overlayPatch) return;
    useTraceEditStore.getState().adoptBasePatch({ traceId, basePatch: overlayPatch });
  }, [isEditing, traceId, overlayPatch]);

  useEffect(() => {
    if (!isEditing) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const isDirty = selectIsTraceEditDirty(useTraceEditStore.getState());
      if (!isDirty) return;
      // The browser shows its own wording here; assigning is what arms it.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditing]);
}
