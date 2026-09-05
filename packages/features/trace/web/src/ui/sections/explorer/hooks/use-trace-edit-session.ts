import { useEffect } from "react";
import { selectIsTraceEditDirty, useDrawerStore, useTraceEditStore } from "../../../../index";
import { useTraceEditOverlay } from "./use-trace-edit-overlay";

/**
 * Keeps an editing session honest for as long as it is open:
 */
export function useTraceEditSession(traceId: string | undefined): void {
  const isEditing = useDrawerStore((s) => s.isEditing);
  const overlay = useTraceEditOverlay();
  const overlayPatch = overlay.data?.patch;

  useEffect(() => {
    if (!isEditing || !traceId || !overlayPatch) return;
    useTraceEditStore.getState().adoptBasePatch({ traceId, basePatch: overlayPatch });
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
