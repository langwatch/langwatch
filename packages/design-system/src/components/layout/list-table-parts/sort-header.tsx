import { Box, Table, VisuallyHidden, chakra } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";

import { type ColumnWidth, type DataAttributes, dataAttributes, sizing } from "./shared.ts";

export type SortDirection = "asc" | "desc";

export interface ListTableSortHeaderProps extends DataAttributes {
  children: ReactNode;
  /** The column's current order, or `false` when another column sorts the list. */
  sorted: SortDirection | false;
  /** 1-based; shown and announced only while more than one column sorts. */
  sortRank?: number;
  /** `multi`: Shift held. TanStack: column.toggleSorting(undefined, multi). */
  onSort: (args: { multi: boolean }) => void;
  align?: "start" | "end";
  width?: ColumnWidth;
  minWidth?: ColumnWidth;
  maxWidth?: ColumnWidth;
  "aria-colindex"?: number;
}

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown, none: ArrowUpDown } as const;
const ARIA_SORT = { asc: "ascending", desc: "descending", none: "none" } as const;

/** Widths a caller still types as plain strings. */
type LooseWidths = {
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
};

/**
 * A sortable column header. The label reads as the other headers; the arrow shows the order,
 * `aria-sort` on the header cell tells assistive tech. The page owns the order.
 */
export function SortHeader(props: ListTableSortHeaderProps): ReactNode;
/** @deprecated Type widths as `ColumnWidth`; plain strings still pass through as CSS lengths. */
export function SortHeader(
  props: Omit<ListTableSortHeaderProps, "width" | "minWidth" | "maxWidth"> & LooseWidths,
): ReactNode;
export function SortHeader({
  children,
  sorted,
  sortRank,
  onSort,
  align = "start",
  width,
  minWidth,
  maxWidth,
  "aria-colindex": colIndex,
  ...rest
}: Omit<ListTableSortHeaderProps, "width" | "minWidth" | "maxWidth"> & LooseWidths): ReactNode {
  const order = sorted || "none";
  const ArrowIcon = SORT_ICON[order];
  return (
    <Table.ColumnHeader
      aria-sort={ARIA_SORT[order]}
      aria-colindex={colIndex}
      textAlign={align}
      {...sizing({ width, minWidth, maxWidth })}
      {...dataAttributes(rest)}
    >
      <chakra.button
        type="button"
        onClick={(event) => onSort({ multi: event.shiftKey })}
        display="inline-flex"
        alignItems="center"
        gap={1}
        flexDirection={align === "end" ? "row-reverse" : "row"}
        font="inherit"
        color={sorted ? "fg" : "inherit"}
        cursor="pointer"
        borderRadius="xs"
        _hover={{ color: "fg" }}
        _focusVisible={{ outline: "2px solid", outlineColor: "colorPalette.focusRing" }}
      >
        {children}
        <Box as="span" color={sorted ? "fg" : "fg.subtle"} display="inline-flex" gap={0.5}>
          <ArrowIcon size={12} aria-hidden />
          {sorted && sortRank !== undefined && (
            <>
              <Box as="span" aria-hidden textStyle="2xs" fontVariantNumeric="tabular-nums">
                {sortRank}
              </Box>
              <VisuallyHidden>, sort order {sortRank}</VisuallyHidden>
            </>
          )}
        </Box>
      </chakra.button>
    </Table.ColumnHeader>
  );
}
