import { useRef } from "react";
import type { MappingState } from "~/server/tracer/tracesMapping";

/**
 * Filters the mapping editor's callbacks down to the user's edits. The editor
 * reports the mapping it derives when it opens (and when the columns change);
 * that pass is its starting point, not an edit, so it is never saved.
 */
export function useMappingEditsOnly({
  columns,
  savedMapping,
  onEdit,
}: {
  columns: string[];
  savedMapping: unknown;
  onEdit: (next: MappingState) => void;
}) {
  const startRef = useRef<{
    columnsKey: string;
    derived: string;
    hasEdited: boolean;
  } | null>(null);

  return (next: MappingState) => {
    const columnsKey = JSON.stringify(columns);
    const serialised = JSON.stringify(next);
    const start = startRef.current;
    if (start?.columnsKey !== columnsKey) {
      startRef.current = { columnsKey, derived: serialised, hasEdited: false };
      return;
    }
    if (serialised === JSON.stringify(savedMapping)) return;
    if (!start.hasEdited && serialised === start.derived) return;
    start.hasEdited = true;
    onEdit(next);
  };
}
