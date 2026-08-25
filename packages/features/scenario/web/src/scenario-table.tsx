import { HStack, IconButton, Table, Text } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Menu } from "@langwatch/design-system/menu";
import {
  type ColumnFiltersState,
  createColumnHelper,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Archive, ChevronDown, ChevronUp, MoreVertical } from "lucide-react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { ScenarioListItem } from "./scenario-list.types";

export type ScenarioTableProps = {
  scenarios: ScenarioListItem[];
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange(filters: ColumnFiltersState): void;
  onRowClick(scenarioId: string): void;
  rowSelection: RowSelectionState;
  onRowSelectionChange(selection: RowSelectionState): void;
  onArchive(scenario: ScenarioListItem): void;
  formatUpdatedAt(updatedAt: Date): string;
  renderLabels(labels: string[]): ReactNode;
  renderRow(scenario: ScenarioListItem, row: ReactElement): ReactElement;
};

const columnHelper = createColumnHelper<ScenarioListItem>();

const labelsFilterFn: FilterFn<ScenarioListItem> = (row, columnId, filterValue) => {
  const labels = row.getValue<string[]>(columnId);
  const activeLabels = Array.isArray(filterValue)
    ? filterValue.filter((value): value is string => typeof value === "string")
    : [];
  return (
    activeLabels.length === 0 || activeLabels.some((label) => labels.includes(label))
  );
};

export function ScenarioTable({
  scenarios,
  columnFilters,
  onColumnFiltersChange,
  onRowClick,
  rowSelection,
  onRowSelectionChange,
  onArchive,
  formatUpdatedAt,
  renderLabels,
  renderRow,
}: ScenarioTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            onChange={() => table.toggleAllPageRowsSelected()}
            onClick={(event) => event.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onChange={() => row.toggleSelected()}
            onClick={(event) => event.stopPropagation()}
          />
        ),
        enableSorting: false,
      }),
      columnHelper.accessor("name", {
        header: "Name",
        cell: (info) => <Text fontWeight="medium">{info.getValue()}</Text>,
      }),
      columnHelper.accessor("labels", {
        header: "Labels",
        enableSorting: false,
        filterFn: labelsFilterFn,
        cell: (info) => renderLabels(info.getValue()),
      }),
      columnHelper.accessor("updatedAt", {
        header: "Updated",
        cell: (info) => <Text color="fg.muted">{formatUpdatedAt(info.getValue())}</Text>,
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                aria-label={`Actions for ${row.original.name}`}
                variant="ghost"
                size="sm"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content portalled={false}>
              <Menu.Item
                value="archive"
                color="orange.500"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive(row.original);
                }}
              >
                <Archive size={14} />
                Archive
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        ),
        enableSorting: false,
      }),
    ],
    [formatUpdatedAt, onArchive, renderLabels],
  );

  const table = useReactTable({
    data: scenarios,
    columns,
    state: { sorting, columnFilters, rowSelection },
    enableRowSelection: true,
    onRowSelectionChange: (updater) => {
      const selection = typeof updater === "function" ? updater(rowSelection) : updater;
      onRowSelectionChange(selection);
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: (updater) => {
      const filters = typeof updater === "function" ? updater(columnFilters) : updater;
      onColumnFiltersChange(filters);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (scenario) => scenario.id,
  });

  return (
    <Table.Root variant="line" width="full" size="md">
      <Table.Header>
        {table.getHeaderGroups().map((headerGroup) => (
          <Table.Row key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <Table.ColumnHeader
                key={header.id}
                cursor={header.column.getCanSort() ? "pointer" : "default"}
                onClick={header.column.getToggleSortingHandler()}
                userSelect="none"
                {...(header.id === "select"
                  ? { width: "40px" }
                  : header.id === "actions"
                    ? { width: "48px" }
                    : {})}
              >
                <HStack gap={1}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() === "asc" && <ChevronUp size={14} />}
                  {header.column.getIsSorted() === "desc" && <ChevronDown size={14} />}
                </HStack>
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        ))}
      </Table.Header>
      <Table.Body>
        {table.getRowModel().rows.map((row) => {
          const rowElement = (
            <Table.Row
              key={row.id}
              cursor="pointer"
              _hover={{ bg: "bg.emphasized" }}
              onClick={() => onRowClick(row.original.id)}
            >
              {row.getVisibleCells().map((cell) => (
                <Table.Cell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </Table.Cell>
              ))}
            </Table.Row>
          );

          return renderRow(row.original, rowElement);
        })}
      </Table.Body>
    </Table.Root>
  );
}
