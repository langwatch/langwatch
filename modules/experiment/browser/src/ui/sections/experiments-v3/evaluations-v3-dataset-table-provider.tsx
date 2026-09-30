import {
  type DatasetTableContextValue,
  DatasetTableProvider,
} from "@langwatch/dataset-browser-kit";
import { getImageUrl } from "@langwatch/design-system/external-image";
import { StoredObjectImage } from "@langwatch/stored-object-browser-kit";
/**
 * Adapter that backs the shared dataset table cells with the evaluations workbench
 * store. The cells (EditableCell, TableCell) only know the narrow DatasetTableContext
 * contract; this provider maps the workbench's zustand state onto it.
 */
import type { PropsWithChildren, ReactNode } from "react";

import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";

const renderImage = (value: string): ReactNode | null => {
  const src = getImageUrl(value);
  return src ? (
    <StoredObjectImage
      src={src}
      minWidth="24px"
      minHeight="24px"
      maxHeight="80px"
      maxWidth="100%"
      expandable
    />
  ) : null;
};

export function EvaluationsV3DatasetTableProvider({ children }: PropsWithChildren) {
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
    renderImage,
  }));

  return <DatasetTableProvider value={value}>{children}</DatasetTableProvider>;
}
