/**
 * TableSkeleton - Loading skeleton for batch evaluation tables
 *
 * Displays a placeholder table with animated skeleton cells
 * while data is being loaded.
 */
import { Box, Card, Skeleton } from "@chakra-ui/react";

type TableSkeletonProps = {
  /** Number of rows to show in skeleton */
  rows?: number;
  /** Number of columns to show in skeleton */
  columns?: number;
  /** Whether to wrap in a Card component */
  withCard?: boolean;
};

const SkeletonTable = ({
  rows = 5,
  columns = 3,
}: Omit<TableSkeletonProps, "withCard">) => (
  <Box
    overflowX="auto"
    width="full"
    css={{
      "& table": { width: "100%", borderCollapse: "collapse" },
      "& th": {
        borderBottom: "1px solid var(--chakra-colors-gray-200)",
        padding: "8px 12px",
        textAlign: "left",
      },
      "& td": {
        borderBottom: "1px solid var(--chakra-colors-gray-100)",
        padding: "12px",
      },
    }}
  >
    <table>
      <thead>
        <tr>
          <th style={{ width: "32px" }} />
          {Array.from({ length: columns }).map((_, colIdx) => (
            <th key={colIdx}>
              <Skeleton height="16px" width={`${60 + colIdx * 20}px`} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <tr key={rowIdx}>
            <td style={{ width: "32px" }}>
              <Skeleton height="14px" width="16px" />
            </td>
            {Array.from({ length: columns }).map((_, colIdx) => (
              <td key={colIdx}>
                <Skeleton height="16px" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </Box>
);

export const TableSkeleton = ({
  rows = 5,
  columns = 3,
  withCard = false,
}: TableSkeletonProps) => {
  if (withCard) {
    return (
      <Card.Root width="100%" overflow="hidden">
        <Card.Body padding={0}>
          <SkeletonTable rows={rows} columns={columns} />
        </Card.Body>
      </Card.Root>
    );
  }

  return <SkeletonTable rows={rows} columns={columns} />;
};
