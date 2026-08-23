import { useEffect } from "react";
import { useDrawerStore } from "../stores/drawerStore";
import {
  selectIsTraceEditDirty,
  useTraceEditStore,
} from "../stores/traceEditStore";
import { useTraceEditOverlay } from "./useTraceEditOverlay";

/**
 * Keeps an editing session honest for as long as it is open:
 *
 *   - the stored correction becomes the session's baseline once the read for
 *     it lands, so correcting a trace twice adds to the first correction
 *     rather than replacing it,
 *   - leaving the page with unsaved work asks first.
 *
 * Mounted by the drawer body, which is the only place edit mode exists.
 */
export function useTraceEditSession(traceId: string | undefined): void {
  const isEditing = useDrawerStore((s) => s.isEditing);
  const overlay = useTraceEditOverlay();
  const overlayPatch = overlay.data?.patch;

  useEffect(() => {
    if (!isEditing || !traceId || !overlayPatch) return;
    useTraceEditStore
      .getState()
      .adoptBasePatch({ traceId, basePatch: overlayPatch });
  }, [isEditing, traceId, overlayPatch]);

  useEffect(() => {
    if (!isEditing) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!selectIsTraceEditDirty(useTraceEditStore.getState())) return;
      // The browser shows its own wording here; assigning is what arms it.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditing]);
}
