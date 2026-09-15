import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";

export function useScenarioSelection() {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const onRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback((updater) => {
    setRowSelection((currentSelection) =>
      typeof updater === "function" ? updater(currentSelection) : updater,
    );
  }, []);

  const toggle = useCallback((id: string) => {
    setRowSelection((currentSelection) => {
      const selection = { ...currentSelection };
      if (selection[id]) {
        delete selection[id];
      } else {
        selection[id] = true;
      }
      return selection;
    });
  }, []);

  const selectAll = useCallback((visibleIds: string[]) => {
    setRowSelection((currentSelection) => {
      const selection = { ...currentSelection };
      for (const id of visibleIds) {
        selection[id] = true;
      }
      return selection;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setRowSelection({});
  }, []);

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection],
  );

  return {
    toggle,
    selectAll,
    deselectAll,
    selectedIds,
    selectionCount: selectedIds.length,
    rowSelection,
    onRowSelectionChange,
  };
}
