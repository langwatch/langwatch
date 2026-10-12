import type { KeyboardEvent, ReactNode } from "react";

import { flag } from "../class-names.ts";

export type TableColumn<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** A column width such as "96px" or "30%"; the rest share what is left. */
  width?: string;
  align?: "start" | "end";
  mono?: boolean;
  muted?: boolean;
  /** The full value shown on hover when the cell truncates; string cells get it free. */
  title?: (row: Row) => string;
  /** Drop this column under 720px, where only the columns that identify a row fit. */
  hideOnNarrow?: boolean;
};

export type TableProps<Row> = {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** What the single row says when there are no rows. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  /** Read by screen readers only. */
  caption?: string;
  /** Scroll inside the table past this height (240/400/640px); the head stays put. */
  maxHeight?: "sm" | "md" | "lg";
};

const cellTitle = <Row,>({
  column,
  row,
  content,
}: {
  column: TableColumn<Row>;
  row: Row;
  content: ReactNode;
}) => {
  if (column.title) return column.title(row);
  if (typeof content === "string" || typeof content === "number") return String(content);
  return undefined;
};

const BodyRow = <Row,>({
  row,
  columns,
  onRowClick,
}: {
  row: Row;
  columns: TableColumn<Row>[];
  onRowClick?: (row: Row) => void;
}) => {
  const activate = onRowClick ? () => onRowClick(row) : undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate?.();
  };
  return (
    <tr
      data-clickable={flag({ on: activate !== undefined })}
      tabIndex={activate ? 0 : undefined}
      onClick={activate}
      onKeyDown={activate ? onKeyDown : undefined}
    >
      {columns.map((column) => {
        const content = column.cell(row);
        return (
          <td
            key={column.key}
            data-narrow={column.hideOnNarrow ? "hide" : undefined}
            data-align={column.align}
            data-mono={flag({ on: column.mono })}
            data-tone={column.muted ? "muted" : undefined}
            title={cellTitle({ column, row, content })}
          >
            {content}
          </td>
        );
      })}
    </tr>
  );
};

export const Table = <Row,>({
  columns,
  rows,
  rowKey,
  empty = "Nothing here yet.",
  onRowClick,
  caption,
  maxHeight,
}: TableProps<Row>) => (
  <div className="ds-table-wrap" data-max-height={maxHeight}>
    <table className="ds-table">
      {caption !== undefined && <caption className="ds-visually-hidden">{caption}</caption>}
      <colgroup>
        {columns.map((column) => (
          <col
            key={column.key}
            data-narrow={column.hideOnNarrow ? "hide" : undefined}
            style={column.width ? { width: column.width } : undefined}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              data-narrow={column.hideOnNarrow ? "hide" : undefined}
              data-align={column.align}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr className="ds-table-empty">
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((row) => (
            <BodyRow key={rowKey(row)} row={row} columns={columns} onRowClick={onRowClick} />
          ))
        )}
      </tbody>
    </table>
  </div>
);
