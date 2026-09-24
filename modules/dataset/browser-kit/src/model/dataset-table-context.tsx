/**
 * Narrow contract between a dataset spreadsheet table and whatever owns
 * its state. The editor cells are shared across surfaces (the workbench's
 * zustand store, the standalone editor's own) and only ever talk to this.
 */
import { createContext, type ReactNode, type RefObject, useContext } from "react";

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

/** What the cell of an `image` or `file` column hands a table that lets people upload into it. */
export type DatasetAttachmentSlot = {
  value: string;
  columnType: "image" | "file";
  datasetId: string;
  /** Text to render for a value that is neither an address nor a reference. */
  fallbackText: string;
  fallbackTruncated: boolean;
  onChange: (value: string) => void;
  /** Opens the text editor, the same one a double click opens. */
  onOpenEditor: () => void;
};

export type DatasetTableContextValue = {
  rowHeightMode: RowHeightMode;
  expandedCells: Set<string>;
  editingCell: CellPosition | undefined;
  selectedCell: CellPosition | undefined;
  setCellValue: (datasetId: string, row: number, columnId: string, value: string) => void;
  setEditingCell: (cell: CellPosition | undefined) => void;
  setSelectedCell: (cell: CellPosition | undefined) => void;
  toggleCellExpanded: (row: number, columnId: string) => void;
  toggleRowSelection: (row: number) => void;
  renderImage: (value: string) => ReactNode | null;
  /** Absent on a table nobody uploads into; its image cells use `renderImage`. */
  renderAttachment?: (slot: DatasetAttachmentSlot) => ReactNode;
  /** Where the floating cell editor portals to. Required when the table is
   *  hosted inside a modal dialog: portaling to document.body would land
   *  outside the dialog's pointer-events scope and the editor would be
   *  unclickable. Defaults to document.body. */
  editorPortalRef?: RefObject<HTMLDivElement | null>;
};

const DatasetTableContext = createContext<DatasetTableContextValue | null>(null);

export const DatasetTableProvider = DatasetTableContext.Provider;

export function useDatasetTable(): DatasetTableContextValue {
  const ctx = useContext(DatasetTableContext);
  if (!ctx) {
    throw new Error("useDatasetTable must be used inside a DatasetTableProvider");
  }
  return ctx;
}
