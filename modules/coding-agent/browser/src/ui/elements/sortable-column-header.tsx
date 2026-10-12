import { type ColumnWidth, ListTable } from "@langwatch/design-system/list-table";

import type { ColumnSortState } from "../../behavior/column-sort.ts";

/** Sortable heading: the table's sort header; the arrow shows the order and aria-sort says it. */
export function SortableColumnHeader<Column extends string>({
  label,
  column,
  sort,
  onSort,
  align = "start",
  width,
  minWidth,
}: {
  label: string;
  column: Column;
  sort: ColumnSortState<Column>;
  onSort: (column: Column) => void;
  align?: "start" | "end";
  /**
   * Column width. `"1%"` with nowrap content is the shrink-to-fit idiom: the
   * column hugs its widest cell and grows with it, and the freed width goes
   * to the columns that truncate.
   */
  width?: ColumnWidth;
  /**
   * Floor under the shrink-to-fit width, so a hugged column keeps clear air
   * between its values and the next column's instead of butting its content
   * against a hairline border.
   */
  minWidth?: ColumnWidth;
}) {
  return (
    <ListTable.SortHeader
      sorted={sort.column === column ? sort.direction : false}
      onSort={() => onSort(column)}
      align={align}
      width={width}
      minWidth={minWidth}
    >
      {label}
    </ListTable.SortHeader>
  );
}
