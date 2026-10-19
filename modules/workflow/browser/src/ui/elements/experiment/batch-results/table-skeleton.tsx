/**
 * TableSkeleton - Loading skeleton for batch evaluation tables
 */
import { ListTable } from "@langwatch/design-system/list-table";
import { Skeleton } from "@langwatch/design-system/primitives";

type TableSkeletonProps = {
  /** Number of rows to show in skeleton */
  rows?: number;
  /** Number of columns to show in skeleton */
  columns?: number;
};

export const TableSkeleton = ({ rows = 5, columns = 3 }: TableSkeletonProps) => (
  <ListTable variant="embedded" loading loadingLabel="Loading results">
    <ListTable.Header>
      <ListTable.Row>
        <ListTable.ColumnHeader width="32px" />
        {Array.from({ length: columns }, (_, column) => (
          <ListTable.ColumnHeader key={column}>
            <Skeleton height="16px" width={`${60 + column * 20}px`} />
          </ListTable.ColumnHeader>
        ))}
      </ListTable.Row>
    </ListTable.Header>
    <ListTable.Body>
      <ListTable.LoadingRows rows={rows} columns={columns + 1} />
    </ListTable.Body>
  </ListTable>
);
