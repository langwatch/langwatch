import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import { useMemo } from "react";
import { MultilineCellEditor } from "./MultilineCellEditor";
import { Skeleton } from "@chakra-ui/react";
import type { GridOptions } from "ag-grid-community";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-balham.css";
import { RenderInputOutput } from "../traces/RenderInputOutput";

export const JSONCellRenderer = (props: { value: string | undefined }) => {
  return (
    <RenderInputOutput
      value={props.value}
      groupArraysAfterLength={1}
      collapseStringsAfterLength={100}
    />
  );
};

export function DatasetGrid(props: AgGridReactProps) {
  const gridOptions: GridOptions = useMemo(
    () => ({
      rowDragManaged: true,
      rowDragMultiRow: true,
      undoRedoCellEditing: true,
      undoRedoCellEditingLimit: 50,
      groupSelectsChildren: true,
      suppressRowClickSelection: true,
    }),
    []
  );

  return (
    <div className="ag-theme-balham">
      <style>{`
        .ag-theme-balham .ag-cell {
          white-space: pre-wrap; /* Enable word wrapping */
          overflow: visible; /* Ensure the cell expands to fit content */
          line-height: 1.6em;
          border-right: var(--ag-borders-critical) var(--ag-row-border-color);
        }
        .ag-cell-last-left-pinned .ag-cell-value {
          white-space: nowrap;
        }
        .ag-cell-last-left-pinned {
          background-color: var(--ag-header-background-color);
        }
        .ag-theme-balham .ag-cell .ag-cell-value {
          padding-top: 4px;
          padding-bottom: 4px;
          font-size: 13px;
        }
        .ag-header-cell-label {
          font-size: 13px;
        }
        .ag-theme-balham .ag-cell .chakra-textarea {
          height: 100%!important;
        }
        .ag-large-text, .ag-large-text-input, .ag-large-text-input > .ag-input-wrapper, .ag-input-wrapper > textarea {
          width: 100%;
          height: 100%!important;
          padding: 0;
        }
        .ag-cell-wrapper textarea {
          padding: 3px 11px;
          outline: none;
          border: none;
        }
      `}</style>
      <AgGridReact
        gridOptions={gridOptions}
        loadingOverlayComponent={() => <Skeleton height="20px" />}
        reactiveCustomComponents={true}
        enableCellEditingOnBackspace={false}
        domLayout="autoHeight"
        defaultColDef={{
          flex: 1,
          minWidth: 10,
          resizable: true,
          sortable: true,
          filter: true,
          editable: true,
          autoHeight: true,
          cellEditor: MultilineCellEditor,
          enableCellChangeFlash: true,
          suppressKeyboardEvent: (props) => {
            if (props.event.key == "Enter" && props.event.shiftKey) {
              props.event.stopPropagation();
              return true;
            }
            return false;
          },
        }}
        {...props}
      />
    </div>
  );
}
