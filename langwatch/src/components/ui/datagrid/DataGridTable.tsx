import type { ReactNode } from "react";
import { Box, Table, Text } from "@chakra-ui/react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type HeaderContext,
  type CellContext,
} from "@tanstack/react-table";
import { ColumnHeader } from "./ColumnHeader";
import { ExpandableRow } from "./ExpandableRow";
import { ExpandToggleCell } from "./cells/ExpandToggleCell";
import type { DataGridColumnDef, FilterState, SortingState } from "./types";

interface DataGridTableProps<T> {
  data: T[];
  columns: DataGridColumnDef<T>[];
  visibleColumns: Set<string>;
  sorting: SortingState | null;
  filters: FilterState[];
  groupBy: string | null;
  expandedRows: Set<string>;
  getRowId: (row: T) => string;
  onSort: (columnId: string, order: "asc" | "desc" | null) => void;
  onAddFilter: (filter: FilterState) => void;
  onRemoveFilter: (columnId: string, index: number) => void;
  onGroupBy: (columnId: string | null) => void;
  onToggleColumnVisibility: (columnId: string) => void;
  onPinColumn: (columnId: string, position: "left" | "right" | false) => void;
  onToggleRowExpansion: (rowId: string) => void;
  renderExpandedContent?: (row: T) => ReactNode;
  getEnumOptions?: (columnId: string) => string[];
  isLoading?: boolean;
  emptyMessage?: string;
}

/**
 * Core table component using TanStack Table
 */
export function DataGridTable<T>({
  data,
  columns: columnDefs,
  visibleColumns,
  sorting,
  filters,
  groupBy,
  expandedRows,
  getRowId,
  onSort,
  onAddFilter,
  onRemoveFilter,
  onGroupBy,
  onToggleColumnVisibility,
  onPinColumn,
  onToggleRowExpansion,
  renderExpandedContent,
  getEnumOptions,
  isLoading,
  emptyMessage = "No data available",
}: DataGridTableProps<T>) {
  // Filter to visible columns and add expand column if needed
  const visibleColumnDefs = columnDefs.filter((col) =>
    visibleColumns.has(col.id)
  );

  // Convert our column defs to TanStack Table format
  const tanstackColumns: ColumnDef<T>[] = [
    // Expand column (if expandable content is provided)
    ...(renderExpandedContent
      ? [
          {
            id: "__expand",
            header: "",
            size: 40,
            cell: ({ row }) => (
              <ExpandToggleCell
                row={row}
                isExpanded={expandedRows.has(row.id)}
                onToggle={onToggleRowExpansion}
              />
            ),
          } as ColumnDef<T>,
        ]
      : []),
    // Data columns
    ...visibleColumnDefs.map((col) => ({
      id: col.id,
      accessorKey: col.accessorKey as string,
      header: ({ header }: HeaderContext<T, unknown>) => (
        <ColumnHeader
          header={header}
          column={col}
          sorting={sorting}
          filters={filters}
          groupBy={groupBy}
          onSort={onSort}
          onAddFilter={onAddFilter}
          onRemoveFilter={onRemoveFilter}
          onGroupBy={onGroupBy}
          onToggleVisibility={onToggleColumnVisibility}
          onPin={onPinColumn}
          enumOptions={getEnumOptions?.(col.id)}
        />
      ),
      cell: col.cell
        ? (ctx: CellContext<T, unknown>) => col.cell!(ctx)
        : (ctx: CellContext<T, unknown>) => <Text>{ctx.getValue()}</Text>,
      size: col.width,
      minSize: col.minWidth,
      maxSize: col.maxWidth,
    })),
  ];

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => getRowId(row),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
  });

  const totalColumns =
    tanstackColumns.length + (renderExpandedContent ? 1 : 0);

  return (
    <Box overflowX="auto">
      <Table.Root size="sm">
        <Table.Header>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Row key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <Table.ColumnHeader
                  key={header.id}
                  style={{
                    width: header.getSize(),
                    minWidth: header.column.columnDef.minSize,
                    maxWidth: header.column.columnDef.maxSize,
                  }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </Table.ColumnHeader>
              ))}
            </Table.Row>
          ))}
        </Table.Header>
        <Table.Body>
          {isLoading ? (
            <Table.Row>
              <Table.Cell colSpan={totalColumns}>
                <Text textAlign="center" py={8} color="gray.500">
                  Loading...
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : data.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={totalColumns}>
                <Text textAlign="center" py={8} color="gray.500">
                  {emptyMessage}
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            table.getRowModel().rows.map((row) => (
              <>
                <Table.Row
                  key={row.id}
                  _hover={{ bg: "gray.50" }}
                  cursor={renderExpandedContent ? "pointer" : "default"}
                  onClick={() => {
                    if (renderExpandedContent) {
                      onToggleRowExpansion(row.id);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <Table.Cell
                      key={cell.id}
                      style={{
                        width: cell.column.getSize(),
                        minWidth: cell.column.columnDef.minSize,
                        maxWidth: cell.column.columnDef.maxSize,
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </Table.Cell>
                  ))}
                </Table.Row>
                {/* Expanded content */}
                {renderExpandedContent && expandedRows.has(row.id) && (
                  <ExpandableRow
                    row={row}
                    isExpanded={expandedRows.has(row.id)}
                    colSpan={totalColumns}
                  >
                    {renderExpandedContent(row.original)}
                  </ExpandableRow>
                )}
              </>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
