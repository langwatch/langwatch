import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import { useMemo } from "react";
import { MultilineCellEditor } from "./MultilineCellEditor";
import { Skeleton } from "@chakra-ui/react";
import type { GridOptions } from "ag-grid-community";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-balham.css";

export function DatasetGrid(props: AgGridReactProps) {
  const gridOptions: GridOptions = useMemo(
    () => ({
      rowDragManaged: true,
      rowDragMultiRow: true,
      pivotPanelShow: "always",
      undoRedoCellEditing: true,
      undoRedoCellEditingLimit: 50,
      suppressClearOnFillReduction: false,
      groupSelectsChildren: true,
      suppressRowClickSelection: true,
      columnMenu: "new",
      excelStyles: [
        {
          id: "v-align",
          alignment: {
            vertical: "Center",
          },
        },
        {
          id: "header",
          font: {
            color: "#44546A",
            size: 16,
          },
          interior: {
            color: "#F2F2F2",
            pattern: "Solid",
          },
          alignment: {
            horizontal: "Center",
            vertical: "Center",
          },
          borders: {
            borderTop: {
              lineStyle: "Continuous",
              weight: 0,
              color: "#8EA9DB",
            },
            borderRight: {
              lineStyle: "Continuous",
              weight: 0,
              color: "#8EA9DB",
            },
            borderBottom: {
              lineStyle: "Continuous",
              weight: 0,
              color: "#8EA9DB",
            },
            borderLeft: {
              lineStyle: "Continuous",
              weight: 0,
              color: "#8EA9DB",
            },
          },
        },
      ],
    }),
    []
  );

  return (
    <div className="ag-theme-balham">
      <style>{`
        .ag-theme-balham .ag-cell {
          white-space: pre-wrap; /* Enable word wrapping */
          // overflow: visible; /* Ensure the cell expands to fit content */
          line-height: 1.6em;
          // padding: 0;
        }
        .ag-theme-balham .ag-cell .ag-cell-value {
          // padding: 8px 16px;
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
          minWidth: 100,
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
