/**
 * Dataset preview grid built on the SAME shared cells as the evaluations
 * workbench and the dataset editor (TableCell/EditableCell over
 * DatasetTableContext + datasetTableCss), so previews match their heights,
 * JSON formatting, fade/expand and double-click behaviors exactly.
 *
 * Used by the dataset preview cards and the add-to-dataset mapping preview.
 * The data stays owned by the caller: edits (when `onCellEdit` is passed),
 * checkbox selection (`isSelectable`) and row picking (`onRowClick`) all
 * propagate up instead of being copied into an internal store.
 */
import { Box, Checkbox, HStack, Text } from "@chakra-ui/react";
import {
  type ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { type RefObject, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { DatasetColumns } from "@langwatch/dataset-contract";
import {
  type CellPosition,
  type DatasetTableContextValue,
  DatasetTableProvider,
  type DatasetTableRowData,
} from "../../model/dataset-table-context";
import { datasetTableCss } from "../../model/dataset-table-styles";
import { JSON_LIKE_TYPES } from "../elements/editable-cell";
import { TableCell } from "../elements/table-cell";

export type DatasetPreviewRow = { id?: string; isSelected?: boolean } & Record<string, unknown>;

const CHECKBOX_WIDTH_PX = 36;
const ROW_NUMBER_WIDTH_PX = 48;

const stringifyPreviewValue = (value: unknown): string => {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

export type DatasetPreviewTableProps = {
  rows: DatasetPreviewRow[];
  columns: DatasetColumns;
  maxColumns?: number;
  maxHeight?: string;
  background?: string;
  isSelectable?: boolean;
  onToggleRow?: (rowIndex: number, isSelected: boolean) => void;
  onToggleAll?: (isSelected: boolean) => void;
  onCellEdit?: (rowIndex: number, columnName: string, value: unknown) => void;
  onRowClick?: (rowIndex: number) => void;
  editorPortalRef?: RefObject<HTMLDivElement | null>;
  renderImage?: (value: string) => ReactNode | null;
};

const renderNoImage = (): null => null;

export function DatasetPreviewTable({
  rows,
  columns,
  maxColumns = 8,
  maxHeight,
  background,
  isSelectable = false,
  onToggleRow,
  onToggleAll,
  onCellEdit,
  onRowClick,
  editorPortalRef,
  renderImage = renderNoImage,
}: DatasetPreviewTableProps) {
  const visibleColumns = useMemo(
    () =>
      columns.slice(0, maxColumns).map((col, index) => ({
        id: `${col.name}_${index}`,
        name: col.name,
        type: col.type,
      })),
    [columns, maxColumns],
  );

  const rowData = useMemo(
    (): DatasetTableRowData[] =>
      rows.map((row, index) => {
        const dataset = Object.fromEntries(
          visibleColumns.map((col) => [col.id, stringifyPreviewValue(row[col.name])]),
        );
        return {
          rowIndex: index,
          dataset,
          isEmpty: Object.values(dataset).every((v) => v === ""),
        };
      }),
    [rows, visibleColumns],
  );

  // Cell interaction state, same semantics as the editor's store but local:
  // the preview owns no data, so this is pure view state.
  const [selectedCell, setSelectedCell] = useState<CellPosition | undefined>(void 0);
  const [editingCell, setEditingCell] = useState<CellPosition | undefined>(void 0);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(() => new Set());

  const areAllSelected = isSelectable && rows.length > 0 && rows.every((row) => !!row.isSelected);

  const contextValue = useMemo(
    (): DatasetTableContextValue => ({
      rowHeightMode: "compact",
      expandedCells,
      editingCell,
      selectedCell,
      setCellValue: (_datasetId, rowIndex, columnId, value) => {
        const column = visibleColumns.find((col) => col.id === columnId);
        if (!column) return;
        let parsed: unknown = value;
        if (JSON_LIKE_TYPES.includes(column.type)) {
          try {
            parsed = JSON.parse(value);
          } catch {
            // Not valid JSON: keep the raw edited string.
          }
        }
        onCellEdit?.(rowIndex, column.name, parsed);
      },
      // Without an edit callback the cells are read-only: double-click
      // selects but never opens the floating editor.
      setEditingCell: onCellEdit ? setEditingCell : () => void 0,
      setSelectedCell,
      toggleCellExpanded: (row, columnId) => {
        setExpandedCells((prev) => {
          const next = new Set(prev);
          const key = `${row}-${columnId}`;
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      },
      toggleRowSelection: (rowIndex) => {
        onToggleRow?.(rowIndex, !rows[rowIndex]?.isSelected);
      },
      renderImage,
      editorPortalRef,
    }),
    [
      expandedCells,
      editingCell,
      selectedCell,
      visibleColumns,
      onCellEdit,
      onToggleRow,
      rows,
      renderImage,
      editorPortalRef,
    ],
  );

  const columnHelper = useMemo(() => createColumnHelper<DatasetTableRowData>(), []);

  const tableColumns = useMemo(() => {
    const cols: ColumnDef<DatasetTableRowData>[] = [];

    if (isSelectable) {
      cols.push(
        columnHelper.display({
          id: "select",
          header: () => (
            <Checkbox.Root
              size="sm"
              top="1px"
              aria-label="Select all rows"
              checked={areAllSelected}
              onCheckedChange={() => onToggleAll?.(!areAllSelected)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
            </Checkbox.Root>
          ),
          cell: (info) => (
            <Checkbox.Root
              size="sm"
              aria-label={`Select row ${info.row.index + 1}`}
              checked={!!rows[info.row.index]?.isSelected}
              onCheckedChange={() =>
                onToggleRow?.(info.row.index, !rows[info.row.index]?.isSelected)
              }
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
            </Checkbox.Root>
          ),
          size: CHECKBOX_WIDTH_PX,
          enableResizing: false,
          meta: { columnType: "checkbox", columnId: "__checkbox__" },
        }) as ColumnDef<DatasetTableRowData>,
      );
    } else {
      cols.push(
        columnHelper.display({
          id: "rowNumber",
          header: () => (
            <Text fontSize="13px" color="fg.muted">
              #
            </Text>
          ),
          cell: (info) => (
            <Text fontSize="13px" color="fg.muted">
              {info.row.index + 1}
            </Text>
          ),
          size: ROW_NUMBER_WIDTH_PX,
          enableResizing: false,
        }) as ColumnDef<DatasetTableRowData>,
      );
    }

    for (const column of visibleColumns) {
      cols.push(
        columnHelper.accessor((row) => row.dataset[column.id], {
          id: `dataset.${column.id}`,
          header: () => (
            <HStack gap={1}>
              <ColumnTypeIcon type={column.type} />
              <Text fontSize="13px" fontWeight="medium">
                {column.name}
              </Text>
            </HStack>
          ),
          cell: (info) => info.getValue(),
          meta: {
            columnType: "dataset",
            columnId: column.id,
            dataType: column.type,
          },
        }) as ColumnDef<DatasetTableRowData>,
      );
    }

    return cols;
  }, [columnHelper, visibleColumns, isSelectable, areAllSelected, rows, onToggleAll, onToggleRow]);

  const table = useReactTable({
    data: rowData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Box
      width="full"
      maxHeight={maxHeight}
      overflowY="auto"
      background={background}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      css={{
        ...datasetTableCss,
        "& table": {
          width: "100%",
          borderCollapse: "separate",
          borderSpacing: 0,
          tableLayout: "fixed",
        },
        "& thead th": { position: "sticky", top: 0, zIndex: 2 },
        // Round the last row's outer cells so a selected last row follows the
        // container's rounded corners instead of poking square edges through.
        "& tbody tr:last-child td:first-child": {
          borderBottomLeftRadius: "var(--chakra-radii-md)",
        },
        "& tbody tr:last-child td:last-child": {
          borderBottomRightRadius: "var(--chakra-radii-md)",
        },
      }}
    >
      <DatasetTableProvider value={contextValue}>
        <table data-testid="dataset-preview-table">
          <colgroup>
            <col
              style={{
                width: isSelectable ? CHECKBOX_WIDTH_PX : ROW_NUMBER_WIDTH_PX,
              }}
            />
            {visibleColumns.map((col) => (
              <col key={col.id} />
            ))}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-index={row.index}
                data-selected={rows[row.index]?.isSelected ? "true" : void 0}
                onClick={onRowClick ? () => onRowClick(row.index) : void 0}
                style={onRowClick ? { cursor: "pointer" } : void 0}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    cell={cell}
                    rowIndex={row.index}
                    activeDatasetId="preview"
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </DatasetTableProvider>
    </Box>
  );
}
