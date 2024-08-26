import type { GridOptions } from "@ag-grid-community/core";
import {
  AgGridReact,
  type AgGridReactProps,
  type CustomCellEditorProps,
  type CustomCellRendererProps,
} from "@ag-grid-community/react";
import { Checkbox, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { MultilineCellEditor } from "./MultilineCellEditor";

import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import { ModuleRegistry, type ColDef } from "@ag-grid-community/core";
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-balham.css";
import { z } from "zod";
import {
  datasetColumnTypeMapping,
  type DatasetColumnType,
} from "../../server/datasets/types";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { MultilineJSONCellEditor } from "./MultilineJSONCellEditor";
import React from "react";

ModuleRegistry.registerModules([ClientSideRowModelModule]);

export const JSONCellRenderer = (props: { value: string | undefined }) => {
  return (
    <RenderInputOutput
      value={props.value}
      collapseStringsAfterLength={140}
      collapsed={(props.value?.toString().length ?? 0) > 1000}
    />
  );
};

export type DatasetColumnDef = ColDef & { type_: DatasetColumnType };

export const DatasetGrid = React.memo(
  React.forwardRef(function DatasetGrid(
    props: AgGridReactProps & {
      columnDefs: DatasetColumnDef[];
    },
    ref
  ) {
    const gridOptions: GridOptions = useMemo(
      () => ({
        getRowId: (params) => params.data.id,
        rowDragManaged: true,
        rowDragMultiRow: true,
        undoRedoCellEditing: true,
        undoRedoCellEditingLimit: 50,
        groupSelectsChildren: true,
        suppressRowClickSelection: true,
      }),
      []
    );

    const columnDefs_ = useMemo(() => {
      return (props.columnDefs as DatasetColumnDef[])?.map(
        (column: DatasetColumnDef) => {
          const basicTypes = ["string", "number", "boolean", "date"];
          if (!basicTypes.includes(column.type_)) {
            return {
              ...column,
              cellRenderer: JSONCellRenderer,
              cellEditor: (props: CustomCellEditorProps) => (
                <MultilineJSONCellEditor
                  zodValidator={
                    datasetColumnTypeMapping[column.type_] ?? z.any()
                  }
                  {...props}
                />
              ),
            };
          } else {
            return {
              ...column,
              cellDataType: column.type_ === "string" ? "text" : column.type_,
            };
          }
        }
      );
    }, [props.columnDefs]);

    return (
      <div className="ag-theme-balham">
        <style>{`
        .ag-theme-balham .ag-cell {
          white-space: pre-wrap; /* Enable word wrapping */
          overflow: visible; /* Ensure the cell expands to fit content */
          line-height: 1.6em;
          border-right: var(--ag-borders-critical) var(--ag-row-border-color);
        }
        .ag-pinned-left-cols-container .ag-cell-value {
          white-space: nowrap;
          text-overflow: unset;
        }
        .ag-pinned-left-cols-container .ag-cell {
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
          padding: 4px 11px;
          outline: none;
          border: none;
          line-height: 19.2px;
          font-feature-settings: "kern";
        }

        .ag-layout-auto-height .ag-center-cols-viewport, .ag-layout-auto-height .ag-center-cols-container {
          min-height: 29px;
        }
      `}</style>
        <AgGridReact
          ref={ref as React.RefObject<AgGridReact>}
          gridOptions={gridOptions}
          loadingOverlayComponent={() => <Text paddingTop={4}>Loading...</Text>}
          reactiveCustomComponents={true}
          enableCellEditingOnBackspace={false}
          stopEditingWhenCellsLoseFocus={true}
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
          columnDefs={columnDefs_}
        />
      </div>
    );
  }),
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.rowData) === JSON.stringify(nextProps.rowData) &&
      prevProps.onCellValueChanged === nextProps.onCellValueChanged
    );
  }
);

export function HeaderCheckboxComponent(props: CustomCellRendererProps) {
  const [checkboxState, setCheckboxState] = useState<
    "checked" | "unchecked" | "indeterminate"
  >("unchecked");

  useEffect(() => {
    const updateAllChecked = () => {
      let allChecked = props.api.getDisplayedRowCount() > 0;
      let allUnchecked = true;
      props.api.forEachNode((node) => {
        if (!node.data.selected) {
          allChecked = false;
        } else {
          allUnchecked = false;
        }
      });
      setCheckboxState(
        allChecked ? "checked" : allUnchecked ? "unchecked" : "indeterminate"
      );
    };

    props.api.addEventListener("cellValueChanged", updateAllChecked);
    props.api.addEventListener("rowDataUpdated", updateAllChecked);

    // Initial check
    updateAllChecked();

    return () => {
      props.api.removeEventListener("cellValueChanged", updateAllChecked);
      props.api.removeEventListener("rowDataUpdated", updateAllChecked);
    };
  }, [props.api]);

  return (
    <Checkbox
      marginLeft="3px"
      isChecked={checkboxState === "checked"}
      isIndeterminate={checkboxState === "indeterminate"}
      onChange={(e) => {
        const isChecked = e.target.checked;
        props.api.forEachNode((node) => {
          node.setDataValue("selected", isChecked);
        });
      }}
    />
  );
}
