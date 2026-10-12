import { Skeleton, Table, VisuallyHidden } from "@chakra-ui/react";
import type { MouseEvent, ReactNode, Ref } from "react";

import {
  CONTROLS,
  type ColumnWidth,
  type DataAttributes,
  RowContext,
  dataAttributes,
  sizing,
} from "./shared.ts";

export interface ListTableHeaderProps extends DataAttributes {
  children: ReactNode;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  ref?: Ref<HTMLTableSectionElement>;
}

/** The `thead`. Closed: only these props reach the element, plus `data-*`. */
export function Header({
  children,
  id,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  ref,
  ...rest
}: ListTableHeaderProps) {
  return (
    <Table.Header
      ref={ref}
      id={id}
      aria-label={label}
      aria-labelledby={labelledBy}
      {...dataAttributes(rest)}
    >
      {children}
    </Table.Header>
  );
}

export type ListTableBodyProps = ListTableHeaderProps;

/** The `tbody`; one per virtual item is valid, and the measured unit of a virtual group. */
export function Body({
  children,
  id,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  ref,
  ...rest
}: ListTableBodyProps) {
  return (
    <Table.Body
      ref={ref}
      id={id}
      aria-label={label}
      aria-labelledby={labelledBy}
      {...dataAttributes(rest)}
    >
      {children}
    </Table.Body>
  );
}

export interface ListTableRowProps extends DataAttributes {
  children: ReactNode;
  /** Selection tint; sets data-selected, never aria-selected (a checkbox carries the state). */
  selected?: boolean;
  /** The detail row below is open; tints, does not toggle. */
  expanded?: boolean;
  /** Unavailable: 40% opacity, never activates; the row's RowAction and checkbox share the gate. */
  disabled?: boolean;
  /** Health tint on ops fleet, queue and projection rows. */
  tone?: "warning" | "danger";
  /** Makes the row surface mouse-clickable. No tabIndex, no role, no key handler. */
  onActivate?: () => void;
  /** Called on pointer entry and on focus within the row. */
  onPrefetch?: () => void;
  /** A row whose detail is loading. */
  "aria-busy"?: boolean;
  /** Virtualised tables: header-inclusive, 1-based. */
  "aria-rowindex"?: number;
  id?: string;
  /** Virtualiser measurement. */
  ref?: Ref<HTMLTableRowElement>;
}

/** A light wash over the ground: muted grey at 60% in light, one zinc step up in dark. */
const HOVER = "var(--list-table-row-hover)";
const HOVER_LIGHT = "color-mix(in srgb, var(--chakra-colors-bg-muted) 60%, transparent)";
const HOVER_DARK = "var(--chakra-colors-zinc-800)";
const SELECTED = "var(--chakra-colors-bg-selected)";
const EXPANDED = "var(--chakra-colors-bg-subtle)";
const TONES = { warning: "bg.warning", danger: "bg.error" } as const;
const TONE_GROUND = {
  warning: "var(--chakra-colors-bg-warning)",
  danger: "var(--chakra-colors-bg-error)",
} as const;

/** Whether a click on the row surface (not a control, not from a portal) activates it. */
function isRowSurfaceClick(event: MouseEvent<HTMLTableRowElement>): boolean {
  if (event.defaultPrevented) return false;
  const row = event.currentTarget;
  const target = event.target;
  if (!(target instanceof Element) || !row.contains(target)) return false;
  const control = target.closest(CONTROLS);
  if (control && row.contains(control)) return false;
  const stopped = target.closest("[data-stop-row-activation]");
  return !(stopped && row.contains(stopped));
}

/**
 * A table row. `onActivate` is a mouse convenience: the row gains no tab stop, no role and no
 * key handler; the keyboard target is `ListTable.RowAction` in the primary cell.
 */
export function Row({
  children,
  selected,
  expanded,
  disabled = false,
  tone,
  onActivate,
  onPrefetch,
  "aria-busy": busy,
  "aria-rowindex": rowIndex,
  id,
  ref,
  ...rest
}: ListTableRowProps) {
  const activatable = onActivate !== undefined && !disabled;
  return (
    <RowContext.Provider value={{ disabled }}>
      <Table.Row
        ref={ref}
        id={id}
        aria-busy={busy}
        aria-rowindex={rowIndex}
        data-selected={selected ? "" : undefined}
        data-expanded={expanded ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
        data-tone={tone}
        data-activatable={activatable ? "" : undefined}
        css={{
          "--list-table-row-ground": "transparent",
          "--list-table-row-hover": HOVER_LIGHT,
          _dark: { "--list-table-row-hover": HOVER_DARK },
          // Pinned cells paint the tint as an image, which cannot fade: the row changes at once.
          "&, & > td": { transition: "none" },
          "&:hover": { bg: HOVER, "--list-table-row-ground": HOVER },
          // An id chip shares the row's tint instead of standing out as a white patch.
          "&:hover [data-id-cell] code": { bg: "transparent" },
          "&[data-expanded]": { bg: "bg.subtle", "--list-table-row-ground": EXPANDED },
          ...(tone
            ? { bg: TONES[tone], "&, &:hover": { "--list-table-row-ground": TONE_GROUND[tone] } }
            : {}),
          "&[data-selected], &[data-selected]:hover": {
            bg: "bg.selected",
            "--list-table-row-ground": SELECTED,
          },
          "&[data-activatable]": { cursor: "pointer" },
          "&[data-disabled]": { opacity: 0.4 },
        }}
        onClick={
          activatable
            ? (event: MouseEvent<HTMLTableRowElement>) => {
                if (isRowSurfaceClick(event)) onActivate();
              }
            : undefined
        }
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        {...dataAttributes(rest)}
      >
        {children}
      </Table.Row>
    </RowContext.Provider>
  );
}

export interface ListTableCellProps extends DataAttributes {
  children?: ReactNode;
  /** Default: the table's own (start). */
  align?: "start" | "center" | "end";
  /** Default: the table's own (middle). */
  valign?: "top" | "middle";
  nowrap?: boolean;
  /** One line with an ellipsis; the column needs a width or tableLayout="fixed". */
  truncate?: boolean;
  /** `muted`: secondary text colour. */
  tone?: "default" | "muted";
  /** Ids, hashes. */
  mono?: boolean;
  /** End-aligned tabular figures. */
  numeric?: boolean;
  colSpan?: number;
  rowSpan?: number;
  width?: ColumnWidth;
  minWidth?: ColumnWidth;
  maxWidth?: ColumnWidth;
  /** Clicks inside this cell never reach the row's onActivate (a whole cell of controls). */
  stopRowActivation?: boolean;
  "aria-colindex"?: number;
  title?: string;
  "aria-label"?: string;
}

/** A body cell. It styles its own box and nothing inside it; padding has no prop. */
export function Cell({
  children,
  align,
  valign,
  nowrap,
  truncate,
  tone = "default",
  mono,
  numeric,
  colSpan,
  rowSpan,
  width,
  minWidth,
  maxWidth,
  stopRowActivation,
  "aria-colindex": colIndex,
  title,
  "aria-label": label,
  ...rest
}: ListTableCellProps) {
  return (
    <Table.Cell
      colSpan={colSpan}
      rowSpan={rowSpan}
      aria-colindex={colIndex}
      title={title}
      aria-label={label}
      textAlign={numeric ? "end" : align}
      verticalAlign={valign}
      color={tone === "muted" ? "fg.muted" : undefined}
      fontFamily={mono ? "mono" : undefined}
      fontVariantNumeric={numeric ? "tabular-nums" : undefined}
      {...(nowrap || truncate ? { whiteSpace: "nowrap" } : {})}
      {...(truncate ? { overflow: "hidden", textOverflow: "ellipsis" } : {})}
      {...sizing({ width, minWidth, maxWidth })}
      {...(stopRowActivation ? { "data-stop-row-activation": "" } : {})}
      {...dataAttributes(rest)}
    >
      {children}
    </Table.Cell>
  );
}

export interface ListTableColumnHeaderProps extends DataAttributes {
  /** Omit for an icon-only column and give `label`. */
  children?: ReactNode;
  /** The visually hidden name of an empty header. */
  label?: string;
  align?: "start" | "center" | "end";
  width?: ColumnWidth;
  minWidth?: ColumnWidth;
  maxWidth?: ColumnWidth;
  "aria-colindex"?: number;
}

/** A column header: 12px semibold, muted, uppercase, set by the table. */
export function ColumnHeader({
  children,
  label,
  align,
  width,
  minWidth,
  maxWidth,
  "aria-colindex": colIndex,
  ...rest
}: ListTableColumnHeaderProps) {
  return (
    <Table.ColumnHeader
      aria-colindex={colIndex}
      textAlign={align}
      {...sizing({ width, minWidth, maxWidth })}
      {...dataAttributes(rest)}
    >
      {children}
      {label && <VisuallyHidden>{label}</VisuallyHidden>}
    </Table.ColumnHeader>
  );
}

export interface ListTableColumnGroupProps {
  children: ReactNode;
}

/** The `colgroup` of a fixed-layout or measured table; kept in the DOM. */
export function ColumnGroup({ children }: ListTableColumnGroupProps) {
  return <Table.ColumnGroup>{children}</Table.ColumnGroup>;
}

export interface ListTableColumnProps {
  /** Omitted, no width is declared and the column sizes automatically. */
  width?: ColumnWidth;
  minWidth?: ColumnWidth;
  maxWidth?: ColumnWidth;
  "data-column"?: string;
}

/** One `col`. */
export function Column({ width, minWidth, maxWidth, "data-column": column }: ListTableColumnProps) {
  return <Table.Column data-column={column} {...sizing({ width, minWidth, maxWidth })} />;
}

export interface ListTablePaddingRowProps {
  columns: number;
  height: number;
}

/** A virtualiser spacer: aria-hidden, no border, no padding, never counted in aria-rowindex. */
export function PaddingRow({ columns, height }: ListTablePaddingRowProps) {
  return (
    <Table.Row aria-hidden data-padding-row="" _hover={{ bg: "transparent" }}>
      <Table.Cell
        colSpan={columns}
        data-span-cell=""
        height={`${height}px`}
        borderBottomWidth={0}
      />
    </Table.Row>
  );
}

export interface ListTableSpanRowProps extends DataAttributes {
  columns: number;
  /** A group heading: a quiet band behind the cell. */
  band?: boolean;
  id?: string;
  "aria-rowindex"?: number;
  children: ReactNode;
}

/**
 * A row whose one cell spans every column: an opened row's details, an empty line, a note
 * under the rows. The cell is flush and takes no row hover; what it holds pads itself.
 */
export function SpanRow({
  columns,
  band,
  id,
  "aria-rowindex": rowIndex,
  children,
  ...rest
}: ListTableSpanRowProps) {
  return (
    <Table.Row
      id={id}
      aria-rowindex={rowIndex}
      data-span-row=""
      data-band={band ? "" : undefined}
      _hover={{ bg: band ? "bg.subtle" : "transparent" }}
      bg={band ? "bg.subtle" : "transparent"}
      {...dataAttributes(rest)}
    >
      <Table.Cell colSpan={columns} data-span-cell="">
        {children}
      </Table.Cell>
    </Table.Row>
  );
}

/** Placeholder rows while the first page loads, in place of a Spinner. */
export function LoadingRows({ rows = 5, columns }: { rows?: number; columns: number }) {
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
