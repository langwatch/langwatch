import { Box, type BoxProps, Skeleton, Table, VisuallyHidden, chakra } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { IdText, type IdTextProps } from "../values/id-text.tsx";

/** One header look at every density: 12px medium, muted, sentence case, no tracking. */
const HEADER = {
  paddingY: "0",
  bg: "transparent",
  textTransform: "none",
  letterSpacing: "normal",
  fontSize: "xs",
  lineHeight: "16px",
  fontWeight: "medium",
  color: "fg.muted",
  whiteSpace: "nowrap",
} as const;
const HEADER_HEIGHT = { default: "40px", compact: "32px" } as const;
/** Zero-specificity defaults, so a row's or a cell's own padding wins. */
const COMPACT_CELLS = { "& :where(tbody td)": { paddingY: "1.5", paddingX: "3" } } as const;

/** What the pinned action column paints under itself, so scrolled cells don't show through. */
const GROUND = "--list-table-ground";

function ListTableRoot({
  children,
  containerProps,
  columnRules = false,
  density = "default",
  variant = "card",
  ...props
}: Omit<ComponentProps<typeof Table.Root>, "variant"> & {
  /** `compact`: a shorter header and tighter cells, for dense logs. */
  density?: "default" | "compact";
  /**
   * `card`: the bordered, rounded list on a page. `embedded`: inside a Card or SettingsCard,
   * which already draws the border; no second border, radius or fill.
   */
  variant?: "card" | "embedded";
  /** Opt in to column dividers; ordinary lists use row rules only. */
  columnRules?: boolean;
  /**
   * Overrides on the container, for a page that needs the card itself to scroll rather
   * than clip. The border and the radius are the look and are not meant to be overridden.
   */
  containerProps?: BoxProps;
}) {
  const embedded = variant === "embedded";
  return (
    <Box
      borderWidth={embedded ? 0 : "1px"}
      bg={embedded ? "transparent" : "bg.card"}
      borderColor="border.card"
      borderRadius={embedded ? 0 : "md"}
      overflow="hidden"
      data-variant={variant}
      css={{ [GROUND]: "var(--chakra-colors-bg-card)" }}
      {...containerProps}
    >
      <Table.Root
        borderRadius="inherit"
        variant="line"
        css={{
          "& thead th": { ...HEADER, height: HEADER_HEIGHT[density] },
          ...(density === "compact" ? COMPACT_CELLS : {}),
          // Quiet row rules in the softer separator token.
          "& th, & td": { borderColor: "border.muted" },
          ...(columnRules
            ? {
                "& th:not(:last-of-type), & td:not(:last-of-type)": {
                  borderRightWidth: "1px",
                  borderRightColor: "border.muted",
                },
              }
            : {}),
          // 16px outer columns so content does not hug the border; inside a card the
          // card's own padding lines up with them.
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

export type SortDirection = "asc" | "desc";

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown, none: ArrowUpDown } as const;
const ARIA_SORT = { asc: "ascending", desc: "descending", none: "none" } as const;

/**
 * A sortable column header. The label stays sentence case; the arrow shows the order,
 * `aria-sort` tells assistive tech. One click calls `onSort`; the page owns the order.
 */
function SortHeader({
  children,
  sorted,
  onSort,
  align = "start",
  ...props
}: Omit<ComponentProps<typeof Table.ColumnHeader>, "onClick" | "align"> & {
  children: ReactNode;
  /** The column's current order, or `false` when another column sorts the list. */
  sorted: SortDirection | false;
  onSort: () => void;
  align?: "start" | "end";
}) {
  const order = sorted || "none";
  const ArrowIcon = SORT_ICON[order];
  return (
    <Table.ColumnHeader aria-sort={ARIA_SORT[order]} textAlign={align} {...props}>
      <chakra.button
        type="button"
        onClick={onSort}
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
        <Box as="span" color={sorted ? "fg" : "fg.subtle"} display="inline-flex">
          <ArrowIcon size={12} aria-hidden />
        </Box>
      </chakra.button>
    </Table.ColumnHeader>
  );
}

/** A cell holding an identifier: IdText, cut in the middle, with a copy button. */
function IdCell({ value, label, tail, ...props }: ComponentProps<typeof Table.Cell> & IdTextProps) {
  return (
    <Table.Cell {...props}>
      <IdText value={value} label={label} tail={tail} />
    </Table.Cell>
  );
}

/** Placeholder rows while the first page loads, in place of a Spinner. */
function LoadingRows({ rows = 5, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <Table.Row key={row} aria-hidden data-loading-row="">
          {Array.from({ length: columns }, (_, column) => (
            <Table.Cell key={column}>
              <Skeleton height="12px" width={column === 0 ? "60%" : "40%"} />
            </Table.Cell>
          ))}
        </Table.Row>
      ))}
    </>
  );
}

/** Keeps the row actions in view at the right edge when a wide table scrolls sideways. */
const PINNED = {
  position: "sticky",
  right: 0,
  zIndex: 1,
  width: "1%",
  whiteSpace: "nowrap",
  textAlign: "end",
  background: `var(${GROUND})`,
} as const;

/** The pinned header over the action column; empty, with a hidden name for screen readers. */
function ActionHeader({ label = "Actions" }: { label?: string }) {
  return (
    <Table.ColumnHeader css={PINNED}>
      <VisuallyHidden>{label}</VisuallyHidden>
    </Table.ColumnHeader>
  );
}

/** The row's actions (an overflow menu, one icon button), pinned to the right edge. */
function ActionCell({ children, ...props }: ComponentProps<typeof Table.Cell>) {
  return (
    <Table.Cell
      css={{
        ...PINNED,
        "tr:hover > &": {
          backgroundImage:
            "linear-gradient(var(--chakra-colors-bg-hover), var(--chakra-colors-bg-hover))",
        },
      }}
      onClick={(event) => event.stopPropagation()}
      {...props}
    >
      {children}
    </Table.Cell>
  );
}

/**
 * The one list look: rounded card, quiet rules, sentence-case headers. Compose with
 * Table parts plus SortHeader, IdCell, ActionHeader, ActionCell and LoadingRows.
 */
export const ListTable = Object.assign(ListTableRoot, {
  SortHeader,
  IdCell,
  LoadingRows,
  ActionHeader,
  ActionCell,
});
