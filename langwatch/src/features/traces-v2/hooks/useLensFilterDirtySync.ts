import { useEffect } from "react";
import { useFilterStore } from "../stores/filterStore";
import { useViewStore } from "../stores/viewStore";

/**
 * Bridge: subscribe to `filterStore.queryText` and forward changes into
 * `viewStore.setFilterDraft` so the active lens's "unsaved" dot reflects
 * filter edits. This is the only place filterStore and viewStore are
 * connected; both stores are otherwise independent.
 *
 * Call once at the page level (TracesPage). The hook is idempotent — when
 * the lens's saved filter matches the current text, `setFilterDraft` clears
 * the draft entry rather than carrying a no-op marker.
 */
export function useLensFilterDirtySync(): void {
  const queryText = useFilterStore((s) => s.queryText);
  const setFilterDraft = useViewStore((s) => s.setFilterDraft);

  useEffect(() => {
    setFilterDraft(queryText);
  }, [queryText, setFilterDraft]);
}
