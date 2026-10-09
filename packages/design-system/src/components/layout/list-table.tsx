import { Box, type BoxProps, Table } from "@chakra-ui/react";
import type { ComponentProps } from "react";

/** List table with rounded border, tall header, and grid borders. Compose with Table parts. */
export function ListTable({
  children,
  containerProps,
  ...props
}: ComponentProps<typeof Table.Root> & {
  /**
   * Overrides on the bordered container, for a page that needs the card itself
   * to scroll rather than clip. The border and the radius are the look and are
   * not meant to be overridden.
   */
  containerProps?: BoxProps;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="md"
      overflow="hidden"
      {...containerProps}
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
