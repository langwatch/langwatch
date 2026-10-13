import { Box, type BoxProps, Table, VisuallyHidden } from "@chakra-ui/react";
import type { ComponentProps, ReactNode } from "react";

import { EmptyRow } from "./list-table-parts/empty-row.tsx";
import {
  Body,
  Cell,
  Column,
  ColumnGroup,
  ColumnHeader,
  Header,
  LoadingRows,
  PaddingRow,
  Row,
  SpanRow,
} from "./list-table-parts/parts.tsx";
import {
  ActionCell,
  ActionHeader,
  ExpandCell,
  IdCell,
  SelectCell,
  SelectHeader,
} from "./list-table-parts/pinned.tsx";
import { RowAction } from "./list-table-parts/row-action.tsx";
import { SortHeader } from "./list-table-parts/sort-header.tsx";
import { ScrollEdgeFade, useScrollEdges } from "./scroll-fade.tsx";

export type { ColumnWidth } from "./list-table-parts/shared.ts";
export type { ListTableEmptyRowProps } from "./list-table-parts/empty-row.tsx";
export type {
  ListTableActionCellProps,
  ListTableActionHeaderProps,
  ListTableExpandCellProps,
  ListTableIdCellProps,
  ListTableSelectCellProps,
  ListTableSelectHeaderProps,
} from "./list-table-parts/pinned.tsx";
export type {
  ListTableBodyProps,
  ListTableCellProps,
  ListTableColumnGroupProps,
  ListTableColumnHeaderProps,
  ListTableColumnProps,
  ListTableHeaderProps,
  ListTablePaddingRowProps,
  ListTableRowProps,
  ListTableSpanRowProps,
} from "./list-table-parts/parts.tsx";
export type { ListTableRowActionProps } from "./list-table-parts/row-action.tsx";
export type { ListTableSortHeaderProps, SortDirection } from "./list-table-parts/sort-header.tsx";

/** One header look at every density: 12px semibold, muted, uppercase, widely tracked. */
const HEADER = {
  paddingY: "0",
  bg: "transparent",
  textTransform: "uppercase",
  letterSpacing: "wider",
  fontSize: "xs",
  lineHeight: "16px",
  fontWeight: "semibold",
  color: "fg.muted",
  whiteSpace: "nowrap",
} as const;
const HEADER_HEIGHT = { default: "40px", compact: "32px" } as const;
/** `headerLayout="content"`: the header grows with wrapped content, top-aligned, 10px inset. */
const CONTENT_HEADER = {
  height: "auto",
  verticalAlign: "top",
  whiteSpace: "normal",
  paddingY: "10px",
} as const;
/** Zero-specificity defaults, so a row's or a cell's own padding wins. */
const COMPACT_CELLS = { "& :where(tbody td)": { paddingY: "1.5", paddingX: "3" } } as const;

/** What the pinned columns paint under themselves, so scrolled cells don't show through. */
const GROUND = "--list-table-ground";
/** The row's own tint (hover, selected, toned), painted over the ground on pinned cells. */
const ROW_GROUND = "var(--list-table-row-ground, transparent)";
/** Above the pinned body cells; a collapsed border scrolls away, so the rule is a shadow. */
const STICKY_HEADER = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: `var(${GROUND})`,
  boxShadow: "inset 0 -1px 0 var(--chakra-colors-border-muted)",
} as const;

/** Leading select and expand columns stick left, the action column right; headers sit above all. */
const PINNED = {
  "& [data-pin]": { position: "sticky", zIndex: 1 },
  "& [data-pin=end]": { right: 0, width: "1%", whiteSpace: "nowrap", textAlign: "end" },
  "& [data-pin=start]": { left: 0 },
  "& [data-pin=start] ~ [data-pin=start]": { left: "48px" },
  "& td[data-pin]": {
    backgroundColor: `var(${GROUND})`,
    backgroundImage: `linear-gradient(${ROW_GROUND}, ${ROW_GROUND})`,
  },
  "& thead th[data-pin]": { zIndex: 3, background: `var(${GROUND})` },
} as const;

/** What every list table takes; the parts inside it close their own props. */
interface ListTableBaseProps {
  children: ReactNode;
  /** `compact`: a shorter header and tighter cells, for dense logs. */
  density?: "default" | "compact";
  /**
   * `card`: the bordered, rounded list on a page. `embedded`: inside a Card or SettingsCard,
   * which already draws the border; no second border, radius or fill.
   */
  variant?: "card" | "embedded";
  /** Opt in to column dividers; ordinary lists use row rules only. */
  columnRules?: boolean;
  /** `content`: header cells grow with wrapped content. Default `single-line`, a fixed height. */
  headerLayout?: "single-line" | "content";
  /** `fixed` makes the `width` set on column headers authoritative. */
  tableLayout?: "auto" | "fixed";
  /** The width below which a wide table stops shrinking and scrolls (with `scroll="x"`). */
  minWidth?: string | number;
  /** Fixed body row height in px: cells become single-line, so a virtualiser's estimate holds. */
  rowHeight?: number;
  /** Aria-busy on the table plus a named status; set it on append and refresh too. */
  loading?: boolean;
  /** Default "Loading rows". */
  loadingLabel?: string;
  id?: string;
  "data-testid"?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-rowcount"?: number;
  "aria-colcount"?: number;
}

/**
 * `x`: a wide table scrolls in a focusable region named by `scrollLabel`. `external`: an outer
 * element (a virtual scroller, the page) scrolls and the table never clips; only then can
 * the header stick.
 */
type ListTableScroll =
  | { scroll?: undefined; scrollLabel?: never; stickyHeader?: never }
  | { scroll: "x"; scrollLabel: string; stickyHeader?: never }
  | { scroll: "external"; scrollLabel?: never; stickyHeader?: boolean };

export type ListTableProps = ListTableBaseProps & ListTableScroll;

/** @deprecated Open Table.Root and container props; pass `ListTableProps`. */
export type LegacyListTableProps = Omit<ComponentProps<typeof Table.Root>, "variant"> &
  Omit<ListTableBaseProps, "children" | "tableLayout" | "minWidth" | "headerLayout"> & {
    /** @deprecated Use `scroll`. */
    containerProps?: BoxProps;
    /** @deprecated Use `scroll="external"`, which alone can stick the header. */
    stickyHeader?: boolean;
  };

const SCROLL_REGION = {
  overflowX: "auto",
  overflowY: "hidden",
  tabIndex: 0,
  role: "region",
  _focusVisible: { outline: "2px solid", outlineColor: "colorPalette.focusRing" },
} as const;

function ListTableRoot(props: ListTableProps): ReactNode;
/** @deprecated Style props and `containerProps`; the table's look and scrolling are fixed. */
function ListTableRoot(props: LegacyListTableProps): ReactNode;
function ListTableRoot({
  children,
  containerProps,
  columnRules = false,
  density = "default",
  variant = "card",
  stickyHeader = false,
  rowHeight,
  headerLayout = "single-line",
  loading = false,
  loadingLabel = "Loading rows",
  scroll,
  scrollLabel,
  ...props
}: LegacyListTableProps & {
  headerLayout?: "single-line" | "content";
  scroll?: "x" | "external";
  scrollLabel?: string;
  rowHeight?: number;
  loading?: boolean;
  loadingLabel?: string;
}): ReactNode {
  const embedded = variant === "embedded";
  const scroller = useScrollEdges();
  // Left alone, a table wider than its card scrolls sideways inside it behind an edge fade. A
  // caller that sets `overflow` itself, or picks a `scroll` mode, owns the scrolling.
  const ownsScroll = scroll === undefined && containerProps?.overflow === undefined;
  const table = (
    <Table.Root
      borderRadius="inherit"
      variant="line"
      aria-busy={loading || undefined}
      css={{
        "& thead th": {
          ...HEADER,
          height: HEADER_HEIGHT[density],
          ...(headerLayout === "content" ? CONTENT_HEADER : {}),
          ...(stickyHeader ? STICKY_HEADER : {}),
        },
        ...(density === "compact" ? COMPACT_CELLS : {}),
        ...(rowHeight === undefined
          ? {}
          : {
              "& tbody tr:not([data-span-row]):not([data-padding-row]) td": {
                height: `${rowHeight}px`,
                boxSizing: "border-box",
                paddingY: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            }),
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
        // A spanning cell is flush: what it holds pads itself.
        "& td[data-span-cell]": { padding: "0" },
        ...PINNED,
      }}
      {...props}
    >
      {children}
    </Table.Root>
  );
  return (
    <Box
      position="relative"
      borderWidth={embedded ? 0 : "1px"}
      bg={embedded ? "transparent" : "bg.card"}
      borderColor="border.card"
      borderRadius={embedded ? 0 : "md"}
      {...(scroll === "x"
        ? { ...SCROLL_REGION, "aria-label": scrollLabel }
        : { overflow: scroll === "external" ? "visible" : "hidden" })}
      data-variant={variant}
      css={{ [GROUND]: "var(--chakra-colors-bg-card)" }}
      {...containerProps}
    >
      <VisuallyHidden as="output">{loading ? loadingLabel : ""}</VisuallyHidden>
      {ownsScroll ? (
        <Box ref={scroller.ref} data-list-table-scroller overflowX="auto" borderRadius="inherit">
          {table}
        </Box>
      ) : (
        table
      )}
      <ScrollEdgeFade
        edge="start"
        visible={ownsScroll && scroller.start}
        color={embedded ? undefined : "bg.card"}
      />
      <ScrollEdgeFade
        edge="end"
        visible={ownsScroll && scroller.end}
        color={embedded ? undefined : "bg.card"}
      />
    </Box>
  );
}

/**
 * The one list look: rounded card, quiet rules, sentence-case headers. Compose with its
 * closed parts (`ListTable.Row`, `.Cell`, `.RowAction`, `.SelectCell`, `.EmptyRow`...).
 */
export const ListTable = Object.assign(ListTableRoot, {
  Header,
  Body,
  Row,
  Cell,
  ColumnHeader,
  ColumnGroup,
  Column,
  RowAction,
  SelectHeader,
  SelectCell,
  ExpandCell,
  SortHeader,
  IdCell,
  ActionHeader,
  ActionCell,
  LoadingRows,
  EmptyRow,
  SpanRow,
  PaddingRow,
});

/** The Chakra table, for the named escapes that cannot be a ListTable. */
export { Table as RawTable } from "@chakra-ui/react";
