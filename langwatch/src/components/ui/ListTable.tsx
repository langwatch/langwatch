import { Box, Table } from "@chakra-ui/react";
import type { ComponentProps } from "react";

/**
 * Standard list table for index pages (datasets, settings lists, and future
 * list pages). Wraps Chakra's Table in the shared look:
 *
 *  - a rounded container with an emphasized outer border,
 *  - a taller header row,
 *  - light gray borders between every cell (a quiet grid),
 *  - comfortable left padding on the first column so content does not hug the
 *    border.
 *
 * Compose it with the normal Table.Header / Table.Body / Table.Row /
 * Table.Cell / Table.ColumnHeader parts as children. See
 * dev/docs/best_practices/list-table.md.
 */
export function ListTable({
  children,
  ...props
}: ComponentProps<typeof Table.Root>) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="md"
      overflow="hidden"
    >
      <Table.Root
        variant="line"
        css={{
          // Taller header row with comfortable breathing room.
          "& thead th": {
            height: "52px",
            paddingTop: "3",
            paddingBottom: "3",
          },
          // Quiet light-gray grid: recolor row borders and add a vertical
          // border between every pair of cells.
          "& th, & td": { borderColor: "border.muted" },
          "& th:not(:last-of-type), & td:not(:last-of-type)": {
            borderRightWidth: "1px",
            borderRightColor: "border.muted",
          },
          // A little left padding on the first column so leading content does
          // not hug the border, balanced by the last column's right padding.
          "& th:first-of-type, & td:first-of-type": { paddingLeft: "4" },
          "& th:last-of-type, & td:last-of-type": { paddingRight: "4" },
        }}
        {...props}
      >
        {children}
      </Table.Root>
    </Box>
  );
}
