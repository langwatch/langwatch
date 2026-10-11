import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { IconButton, Table, Text } from "@langwatch/design-system/primitives";
import type { Instant } from "@langwatch/time";
import {
  type Cell,
  type ColumnFiltersState,
  createColumnHelper,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type Header,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  useReactTable,
} from "@tanstack/react-table";
import { Archive, MoreVertical } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

import type { ScenarioListItem } from "../../model/scenario-list.types.ts";

export type ScenarioTableProps = {
  scenarios: ScenarioListItem[];
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (filters: ColumnFiltersState) => void;
  onRowClick: (scenarioId: string) => void;
  rowSelection: RowSelectionState;
  onRowSelectionChange: (selection: RowSelectionState) => void;
  onArchive: (scenario: ScenarioListItem) => void;
  formatUpdatedAt: (updatedAt: Instant) => string;
  renderLabels: (labels: string[]) => ReactNode;
  /**
   * Wraps one rendered row. `row` is the single `<Table.Row>` element: the app's
   * wrapper `cloneElement`s it to add `className` and `style`, so the element
   * type has to say those props are accepted.
   */
  renderRow: (
    scenario: ScenarioListItem,
    row: ReactElement<{ className?: string; style?: CSSProperties }>,
  ) => ReactElement;
};

const columnHelper = createColumnHelper<ScenarioListItem>();

const labelsFilterFn: FilterFn<ScenarioListItem> = (row, columnId, filterValue) => {
  const labels = row.getValue<string[]>(columnId);
  const activeLabels = Array.isArray(filterValue)
    ? filterValue.filter((value): value is string => typeof value === "string")
    : [];
  return activeLabels.length === 0 || activeLabels.some((label) => labels.includes(label));
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
      columnHelper.display({ id: "select", enableSorting: false }),
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
            <Menu.Content>
              <Menu.Item
                value="archive"
                color="orange.fg"
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
    <ListTable>
      <ListTable.Header>
        {table.getHeaderGroups().map((headerGroup) => (
          <ListTable.Row key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <ScenarioHeader key={header.id} header={header} table={table} />
            ))}
          </ListTable.Row>
        ))}
      </ListTable.Header>
      <ListTable.Body>
        {table.getRowModel().rows.map((row) => {
          const rowElement = (
            <Table.Row
              key={row.id}
              cursor="pointer"
              _hover={{ bg: "bg.emphasized" }}
              onClick={() => onRowClick(row.original.id)}
            >
              {row.getVisibleCells().map((cell) => (
                <ScenarioCell key={cell.id} cell={cell} row={row} />
              ))}
            </Table.Row>
          );

          return renderRow(row.original, rowElement);
        })}
      </ListTable.Body>
    </ListTable>
  );
}

type ScenarioRow = Row<ScenarioListItem>;
type ScenarioHeaderCell = Header<ScenarioListItem, unknown>;
type ScenarioTableApi = TanstackTable<ScenarioListItem>;

/** One header cell: select-all, the pinned action column, a sortable or a plain heading. */
function ScenarioHeader({
  header,
  table,
}: {
  header: ScenarioHeaderCell;
  table: ScenarioTableApi;
}) {
  const { column } = header;
  if (column.id === "select") {
    const someSelected = table.getIsSomePageRowsSelected();
    return (
      <ListTable.SelectHeader
        label="Select all"
        checked={table.getIsAllPageRowsSelected() || (someSelected && "indeterminate")}
        onCheckedChange={({ checked }) => table.toggleAllPageRowsSelected(checked)}
      />
    );
  }
  if (column.id === "actions") return <ListTable.ActionHeader />;
  const label = flexRender(column.columnDef.header, header.getContext());
  if (!column.getCanSort()) return <ListTable.ColumnHeader>{label}</ListTable.ColumnHeader>;
  const multiSort = table.getState().sorting.length > 1;
  return (
    <ListTable.SortHeader
      sorted={column.getIsSorted()}
      sortRank={multiSort ? column.getSortIndex() + 1 : void 0}
      onSort={({ multi }) => column.toggleSorting(void 0, multi)}
    >
      {label}
    </ListTable.SortHeader>
  );
}

/** One body cell: the row checkbox, the pinned actions or a plain cell. */
function ScenarioCell({ cell, row }: { cell: Cell<ScenarioListItem, unknown>; row: ScenarioRow }) {
  if (cell.column.id === "select") {
    return (
      <ListTable.SelectCell
        label={`Select ${row.original.name}`}
        checked={row.getIsSelected()}
        onCheckedChange={({ checked }) => row.toggleSelected(checked)}
      />
    );
  }
  const content = flexRender(cell.column.columnDef.cell, cell.getContext());
  if (cell.column.id === "actions") return <ListTable.ActionCell>{content}</ListTable.ActionCell>;
  return <ListTable.Cell>{content}</ListTable.Cell>;
}
