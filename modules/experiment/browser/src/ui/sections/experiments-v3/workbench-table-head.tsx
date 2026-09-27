/** The workbench table's column widths and header cells, resize handles included. */
import { Link } from "@chakra-ui/react";
import { flexRender, type Header, type Table } from "@tanstack/react-table";

import { DRAWER_WIDTH } from "../../../model/experiments-v3/constants.ts";
import type { TableRowData } from "../../../model/experiments-v3/types.ts";
import {
  CHECKBOX_WIDTH_PX,
  TARGET_COL_DEFAULT_PCT,
} from "../../../model/experiments-v3/workbench-column-widths.ts";

type ColumnWidthOf = (columnId: string, columnType: string, isFixedWidth?: boolean) => string;

const sizingOf = (meta: unknown): { columnType: string; isFixedWidth: boolean } => {
  const sizing = meta as { columnType?: string; isFixedWidth?: boolean } | undefined;
  return {
    columnType: sizing?.columnType ?? "unknown",
    isFixedWidth: sizing?.isFixedWidth ?? false,
  };
};

/** Column widths for `table-layout: fixed`, then a filler and the drawer's spacer. */
export function WorkbenchColGroup({
  table,
  getColumnWidth,
}: {
  table: Table<TableRowData>;
  getColumnWidth: ColumnWidthOf;
}) {
  return (
    <colgroup>
      {table.getAllColumns().map((column) => {
        const { columnType, isFixedWidth } = sizingOf(column.columnDef.meta);
        return (
          <col
            key={column.id}
            style={{
              width: getColumnWidth(column.id, columnType, isFixedWidth),
              // The checkbox column never grows past its fixed width.
              ...(isFixedWidth && { maxWidth: `${CHECKBOX_WIDTH_PX}px` }),
            }}
          />
        );
      })}
      <col style={{ width: "auto" }} />
      <col style={{ width: DRAWER_WIDTH }} />
    </colgroup>
  );
}

/**
 * The highlight a clicked variant name gives its column: a brief, fading flash
 * (green for the winner, blue otherwise). The background stays unset when not
 * highlighted so the sticky header keeps its own opaque one.
 */
const highlightStyle = ({
  isHighlighted,
  outcome,
}: {
  isHighlighted: boolean;
  outcome: string | undefined;
}) => {
  const color = outcome === "won" ? "green" : "blue";
  return {
    transition: "box-shadow 300ms ease, background-color 300ms ease",
    boxShadow: isHighlighted
      ? `inset 0 0 0 2px var(--chakra-colors-${color}-400)`
      : "inset 0 0 0 0 transparent",
    ...(isHighlighted && { background: `var(--chakra-colors-${color}-subtle)` }),
  };
};

/** One header cell, with a percentage resize handle that a double-click resets. */
export function WorkbenchHeaderCell({
  header,
  highlightedTargetId,
  highlightOutcome,
  getColumnWidth,
  createResizeHandler,
  handleResizeDoubleClick,
  isColumnResizing,
}: {
  header: Header<TableRowData, unknown>;
  highlightedTargetId: string | undefined;
  highlightOutcome: string | undefined;
  getColumnWidth: ColumnWidthOf;
  createResizeHandler: (
    columnId: string,
    columnType: string,
  ) => (event: React.MouseEvent | React.TouchEvent) => void;
  handleResizeDoubleClick: (columnId: string, columnType: string) => void;
  isColumnResizing: (columnId: string) => boolean;
}) {
  const targetId = header.id.startsWith("target.") ? header.id.replace("target.", "") : undefined;
  const { columnType, isFixedWidth } = sizingOf(header.column.columnDef.meta);
  const isHighlighted = !!targetId && targetId === highlightedTargetId;

  return (
    <th
      style={{
        width: getColumnWidth(header.id, columnType, isFixedWidth),
        ...highlightStyle({ isHighlighted, outcome: highlightOutcome }),
      }}
      // Lets the target editor scroll its column next to the drawer.
      {...(targetId && { "data-target-column": targetId })}
    >
      {header.isPlaceholder
        ? null
        : flexRender(header.column.columnDef.header, header.getContext())}
      {!isFixedWidth && header.id !== "select" && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Resize column"
          onMouseDown={createResizeHandler(header.id, columnType)}
          onTouchStart={createResizeHandler(header.id, columnType)}
          onDoubleClick={() => handleResizeDoubleClick(header.id, columnType)}
          className={`resizer ${isColumnResizing(header.id) ? "isResizing" : ""}`}
        />
      )}
    </th>
  );
}

/** The filler and spacer after the last column; with no targets yet, a nudge to add one. */
export function WorkbenchHeaderFiller({
  hasTargets,
  onAddClick,
}: {
  hasTargets: boolean;
  onAddClick: () => void;
}) {
  if (!hasTargets) {
    return (
      <th colSpan={2} style={{ width: `calc(${DRAWER_WIDTH}px + ${TARGET_COL_DEFAULT_PCT}%)` }}>
        <Link fontSize="xs" color="fg.subtle" fontStyle="italic" onClick={onAddClick}>
          Click "+ Add" above to get started
        </Link>
      </th>
    );
  }
  return <th aria-hidden="true" colSpan={2} style={{ width: "auto", minWidth: DRAWER_WIDTH }}></th>;
}
