/**
 * Narrow contract between a dataset spreadsheet table and whatever owns its
 * state. The editor cells (EditableCell, TableCell, VirtualizedTableBody) are
 * shared across surfaces (the evaluations workbench backs this with its
 * zustand store, the standalone dataset editor backs it with its own store)
 * and only ever talk to this interface.
 */
import { createContext, useContext, type RefObject } from "react";

export type CellPosition = {
  row: number;
  columnId: string;
};

export type RowHeightMode = "compact" | "fit";

export type AutosaveState = "idle" | "saving" | "saved" | "error";

/**
 * Minimal row shape the shared table cells understand. Tables can extend it
 * (the evaluations workbench adds target outputs per row).
 */
export type DatasetTableRowData = {
  rowIndex: number;
  dataset: Record<string, string>;
  /** True when the row has no user-entered values (the Excel-style trailing
   *  phantom row); such rows don't render derived content. */
  isEmpty: boolean;
};

export type DatasetTableContextValue = {
  rowHeightMode: RowHeightMode;
  expandedCells: Set<string>;
  editingCell: CellPosition | undefined;
  selectedCell: CellPosition | undefined;
  setCellValue: (
    datasetId: string,
    row: number,
    columnId: string,
    value: string,
  ) => void;
  setEditingCell: (cell: CellPosition | undefined) => void;
  setSelectedCell: (cell: CellPosition | undefined) => void;
  toggleCellExpanded: (row: number, columnId: string) => void;
  toggleRowSelection: (row: number) => void;
  /** Where the floating cell editor portals to. Required when the table is
   *  hosted inside a modal dialog: portaling to document.body would land
   *  outside the dialog's pointer-events scope and the editor would be
   *  unclickable. Defaults to document.body. */
  editorPortalRef?: RefObject<HTMLDivElement | null>;
};

const DatasetTableContext = createContext<DatasetTableContextValue | null>(
  null,
);

export const DatasetTableProvider = DatasetTableContext.Provider;

export function useDatasetTable(): DatasetTableContextValue {
  const ctx = useContext(DatasetTableContext);
  if (!ctx) {
    throw new Error(
      "useDatasetTable must be used inside a DatasetTableProvider",
    );
  }
  return ctx;
}
