import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

/**
 * Manages row selection state for the scenarios table.
 *
 * Provides toggle, selectAll, and deselectAll operations while
 * exposing TanStack React Table-compatible `rowSelection` and
 * `onRowSelectionChange` for direct use with `useReactTable`.
 */
export function useScenarioSelection() {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const onRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback(
    (updater) => {
      setRowSelection((prev) =>
        typeof updater === "function" ? updater(prev) : updater
      );
    },
    []
  );

  const toggle = useCallback((id: string) => {
    setRowSelection((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((visibleIds: string[]) => {
    setRowSelection((prev) => {
      const next = { ...prev };
      for (const id of visibleIds) {
        next[id] = true;
      }
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setRowSelection({});
  }, []);

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  );

  const selectionCount = selectedIds.length;

  return {
    toggle,
    selectAll,
    deselectAll,
    selectedIds,
    selectionCount,
    rowSelection,
    onRowSelectionChange,
  };
}
