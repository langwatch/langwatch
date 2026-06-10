/**
 * Adapter that backs the shared dataset table cells with the evaluations
 * workbench store. The cells (EditableCell, TableCell) only know the narrow
 * DatasetTableContext contract; this provider maps the workbench's zustand
 * state onto it.
 */
import type { PropsWithChildren } from "react";

import {
  DatasetTableProvider,
  type DatasetTableContextValue,
} from "~/components/datasets/editor/DatasetTableContext";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

export function EvaluationsV3DatasetTableProvider({
  children,
}: PropsWithChildren) {
  const value: DatasetTableContextValue = useEvaluationsV3Store((state) => ({
    rowHeightMode: state.ui.rowHeightMode,
    expandedCells: state.ui.expandedCells,
    editingCell: state.ui.editingCell,
    selectedCell: state.ui.selectedCell,
    setCellValue: state.setCellValue,
    setEditingCell: state.setEditingCell,
    setSelectedCell: state.setSelectedCell,
    toggleCellExpanded: state.toggleCellExpanded,
    toggleRowSelection: state.toggleRowSelection,
  }));

  return <DatasetTableProvider value={value}>{children}</DatasetTableProvider>;
}
