import { useEffect, useRef } from "react";
import { useFilterStore, useViewStore } from "../../../../index";

/**
 * Bridge: subscribe to `filterStore.queryText` and forward changes into
 * `viewStore.setFilterDraft` so the active lens's "unsaved" dot reflects filter edits.
 */
export function useLensFilterDirtySync(): void {
  const queryText = useFilterStore((s) => s.queryText);
  const setFilterDraft = useViewStore((s) => s.setFilterDraft);
  const firstRunRef = useRef(true);

  useEffect(() => {
    // Skip the very first run: filterStore mounts with `queryText=""` and the
    // active lens's filterText is pushed in by useURLSync/selectLens in a
    // separate effect — running here would mark the lens dirty for one frame.
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    setFilterDraft(queryText);
  }, [queryText, setFilterDraft]);
}
