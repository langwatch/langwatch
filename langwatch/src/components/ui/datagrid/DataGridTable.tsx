import { useMemo, useState, type ReactNode } from "react";
import { Box, Flex, Table, Text, Link } from "@chakra-ui/react";
import NextLink from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type HeaderContext,
  type CellContext,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ColumnHeader } from "./ColumnHeader";
import { ExpandableRow } from "./ExpandableRow";
import { ExpandToggleCell } from "./cells/ExpandToggleCell";
import type { DataGridColumnDef, FilterState, SortingState } from "./types";

interface GroupedData<T> {
  groupValue: string;
  rows: T[];
}

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
  /** Called when a row is clicked (not on expand toggle) */
  onRowClick?: (row: T) => void;
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
  onRowClick,
}: DataGridTableProps<T>) {
  // Filter to visible columns and add expand column if needed
  const visibleColumnDefs = columnDefs.filter((col) =>
    visibleColumns.has(col.id)
  );

  // Group data if groupBy is set
  const groupedData = useMemo((): GroupedData<T>[] | null => {
    if (!groupBy) return null;

    const groupCol = columnDefs.find((col) => col.id === groupBy);
    if (!groupCol) return null;

    const groups = new Map<string, T[]>();
    for (const row of data) {
      const accessor = groupCol.accessorKey as keyof T;
      const value = String(row[accessor] ?? "(empty)");
      const existing = groups.get(value) ?? [];
      existing.push(row);
      groups.set(value, existing);
    }

    return Array.from(groups.entries()).map(([groupValue, rows]) => ({
      groupValue,
      rows,
    }));
  }, [data, groupBy, columnDefs]);

  // Track expanded groups (all expanded by default)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(groupedData?.map((g) => g.groupValue) ?? [])
  );

  // Update expanded groups when groupedData changes
  useMemo(() => {
    if (groupedData) {
      setExpandedGroups(new Set(groupedData.map((g) => g.groupValue)));
    }
  }, [groupBy]);

  const toggleGroup = (groupValue: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupValue)) {
        next.delete(groupValue);
      } else {
        next.add(groupValue);
      }
      return next;
    });
  };

  // Helper to create default cell renderer that handles linkTo and accessor values
  const createDefaultCellRenderer = (col: DataGridColumnDef<T>) => {
    return (ctx: CellContext<T, unknown>) => {
      const value = ctx.getValue();
      const displayValue = value == null ? "" : String(value);

      // If column has linkTo, render as a link
      if (col.linkTo) {
        const href = col.linkTo(ctx.row.original);
        return (
          <Link asChild color="blue.500" _hover={{ textDecoration: "underline" }}>
            <NextLink href={href}>{displayValue}</NextLink>
          </Link>
        );
      }

      return <Text>{displayValue}</Text>;
    };
  };

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
          enumLabels={col.enumLabels}
        />
      ),
      // Use custom cell renderer if provided, otherwise use default renderer
      cell: col.cell
        ? (ctx: CellContext<T, unknown>) => col.cell!(ctx)
        : createDefaultCellRenderer(col),
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
          ) : groupedData ? (
            // Render grouped rows
            groupedData.map((group) => (
              <>
                {/* Group header row */}
                <Table.Row
                  key={`group-${group.groupValue}`}
                  bg="gray.100"
                  cursor="pointer"
                  onClick={() => toggleGroup(group.groupValue)}
                >
                  <Table.Cell colSpan={totalColumns}>
                    <Flex align="center" gap={2} py={1}>
                      {expandedGroups.has(group.groupValue) ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <Text fontWeight="semibold">
                        {group.groupValue}
                      </Text>
                      <Text color="gray.500" fontSize="sm">
                        ({group.rows.length} items)
                      </Text>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
                {/* Group rows (if expanded) */}
                {expandedGroups.has(group.groupValue) &&
                  table.getRowModel().rows
                    .filter((row) => group.rows.some((r) => getRowId(r) === row.id))
                    .map((row) => (
                      <>
                        <Table.Row
                          key={row.id}
                          _hover={{ bg: "gray.50" }}
                          cursor={onRowClick ? "pointer" : undefined}
                          onClick={onRowClick ? () => onRowClick(row.original) : undefined}
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
                    ))}
              </>
            ))
          ) : (
            // Render ungrouped rows
            table.getRowModel().rows.map((row) => (
              <>
                <Table.Row
                  key={row.id}
                  _hover={{ bg: "gray.50" }}
                  cursor={onRowClick ? "pointer" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
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
