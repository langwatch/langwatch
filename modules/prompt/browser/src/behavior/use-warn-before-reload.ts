import { useEffect } from "react";

/**
 * Asks before the page unloads while `isUnsaved`: a reload keeps only a tab's
 * prompt id, so unsaved edits are lost (§10.2). The listener is the shape of
 * `useTraceEditSession`'s; the browser shows its own wording.
 */
export function useWarnBeforeReload({ isUnsaved }: { isUnsaved: boolean }): void {
  useEffect(() => {
    if (!isUnsaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isUnsaved]);
}
