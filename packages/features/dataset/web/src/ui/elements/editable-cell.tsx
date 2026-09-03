import { useRef } from "react";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { DatasetCellDisplay } from "./dataset-cell-display";
import { FloatingCellEditor } from "./floating-cell-editor";
import { useDatasetTable } from "../../model/dataset-table-context";

export { JSON_LIKE_TYPES } from "../../model/editable-cell-value";

type EditableCellProps = {
  value: string;
  row: number;
  columnId: string;
  datasetId: string;
  dataType?: DatasetColumnType;
};

export function EditableCell(props: EditableCellProps) {
  const { editingCell } = useDatasetTable();
  const cellRef = useRef<HTMLDivElement>(null);
  const isEditing = editingCell?.row === props.row && editingCell.columnId === props.columnId;

  return (
    <>
      <DatasetCellDisplay {...props} cellRef={cellRef} isEditing={isEditing} />
      <FloatingCellEditor {...props} anchorRef={cellRef} isEditing={isEditing} />
    </>
  );
}
