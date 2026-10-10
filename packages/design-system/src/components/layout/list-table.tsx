import { Box, type BoxProps, Table } from "@chakra-ui/react";
import type { ComponentProps } from "react";

const DEFAULT_HEADER = { height: "52px", paddingTop: "3", paddingBottom: "3" } as const;
const COMPACT_HEADER = {
  height: "36px",
  paddingY: "0",
  paddingX: "3",
  bg: "transparent",
  textTransform: "none",
  letterSpacing: "normal",
  fontSize: "xs",
  fontWeight: "medium",
  color: "fg.muted",
} as const;
/** Zero-specificity defaults, so a row's or a cell's own padding wins. */
const COMPACT_CELLS = { "& :where(tbody td)": { paddingY: "2", paddingX: "3" } } as const;

/** Rounded list table with optional column rules. Compose with Table parts. */
export function ListTable({
  children,
  containerProps,
  columnRules = false,
  density = "default",
  ...props
}: ComponentProps<typeof Table.Root> & {
  /** `compact`: a short, opaque, sentence-case header and tighter cells, for dense logs. */
  density?: "default" | "compact";
  /** Opt in to column dividers; ordinary lists use row rules only. */
  columnRules?: boolean;
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
      bg="bg.card"
      borderColor="border.card"
      borderRadius="md"
      overflow="hidden"
      {...containerProps}
    >
      <Table.Root
        borderRadius="inherit"
        variant="line"
        css={{
          // Taller header row with comfortable breathing room.
          "& thead th": density === "compact" ? COMPACT_HEADER : DEFAULT_HEADER,
          ...(density === "compact" ? COMPACT_CELLS : {}),
          // Quiet light-gray grid: recolor row borders and add a vertical
          // border between every pair of cells.
          "& th, & td": { borderColor: "border.muted" },
          ...(columnRules
            ? {
                "& th:not(:last-of-type), & td:not(:last-of-type)": {
                  borderRightWidth: "1px",
                  borderRightColor: "border.muted",
                },
              }
            : {}),
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
