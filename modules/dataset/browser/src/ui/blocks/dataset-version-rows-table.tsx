/** Read-only dataset rows: one page of a version, or a comparison's added or removed rows. */

import { ListTable } from "@langwatch/design-system/list-table";
import { Text } from "@langwatch/design-system/primitives";

import {
  formatVersionCellValue,
  type DatasetVersionRowItem,
} from "../../model/dataset-version-history.ts";

export type DatasetVersionRowsTableProps = {
  columns: readonly string[];
  rows: readonly DatasetVersionRowItem[];
  /** Names the scroll region for assistive technology. */
  label: string;
  isLoading?: boolean;
};

export function DatasetVersionRowsTable({
  columns,
  rows,
  label,
  isLoading = false,
}: DatasetVersionRowsTableProps) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel={label}>
      <ListTable.Header>
        <ListTable.Row>
          {columns.map((column) => (
            <ListTable.ColumnHeader key={column} minWidth="160px">
              {column}
            </ListTable.ColumnHeader>
          ))}
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {isLoading ? (
          <ListTable.LoadingRows columns={Math.max(columns.length, 1)} rows={5} />
        ) : (
          rows.map((row) => (
            <ListTable.Row key={row.id}>
              {columns.map((column) => {
                const value = formatVersionCellValue(row.entry[column]);
                return (
                  <ListTable.Cell key={column} valign="top">
                    {value ? (
                      <Text fontSize="sm" lineClamp={3} overflowWrap="anywhere">
                        {value}
                      </Text>
                    ) : (
                      <Text fontSize="sm" color="fg.subtle">
                        Empty
                      </Text>
                    )}
                  </ListTable.Cell>
                );
              })}
            </ListTable.Row>
          ))
        )}
      </ListTable.Body>
    </ListTable>
  );
}
