/**
 * Lightweight read-only table for dataset previews: row numbers, stringified
 * values, compact rows. Used by the dataset preview cards and the
 * add-to-dataset mapping preview (which adds a selection checkbox column via
 * `selectable`). Cell text is capped so a heavy mapped value (for example a
 * 100-span trace serialized to JSON) stays cheap to render; double-click a
 * cell to read the full value in an expanded dialog.
 */
import { useMemo, useState } from "react";

import type { DatasetColumns } from "~/server/datasets/types";
import { ExpandedTextDialog } from "../../HoverableBigText";

type PreviewRow = { id?: string; selected?: boolean } & Record<string, unknown>;

/** Cap the text rendered per cell so heavy payloads do not bloat the DOM. */
const PREVIEW_DISPLAY_MAX = 300;

const stringifyPreviewValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

export function DatasetPreviewTable({
  rows,
  columns,
  maxColumns = 8,
  selectable = false,
  onToggleRow,
  onToggleAll,
}: {
  rows: PreviewRow[];
  columns: DatasetColumns;
  maxColumns?: number;
  /** Renders a leading checkbox column bound to each row's `selected`. */
  selectable?: boolean;
  onToggleRow?: (rowIndex: number, selected: boolean) => void;
  onToggleAll?: (selected: boolean) => void;
}) {
  const visibleColumns = useMemo(
    () => columns.slice(0, maxColumns),
    [columns, maxColumns],
  );

  const [expandedValue, setExpandedValue] = useState<string | undefined>(
    undefined,
  );

  const allSelected =
    selectable && rows.length > 0 && rows.every((row) => !!row.selected);

  return (
    <>
      <table
        data-testid="dataset-preview-table"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}
      >
        <thead>
          <tr>
            {selectable ? (
              <th style={previewCheckboxCellStyle({ header: true })}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  style={checkboxInputStyle}
                />
              </th>
            ) : (
              <th style={previewHeaderStyle({ width: 48 })}>#</th>
            )}
            {visibleColumns.map((column) => (
              <th key={column.name} style={previewHeaderStyle({})}>
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id ?? rowIndex}>
              {selectable ? (
                <td style={previewCheckboxCellStyle({})}>
                  <input
                    type="checkbox"
                    aria-label={`Select row ${rowIndex + 1}`}
                    checked={!!row.selected}
                    onChange={(e) => onToggleRow?.(rowIndex, e.target.checked)}
                    style={checkboxInputStyle}
                  />
                </td>
              ) : (
                <td style={previewCellStyle({ width: 48, muted: true })}>
                  {rowIndex + 1}
                </td>
              )}
              {visibleColumns.map((column) => {
                const full = stringifyPreviewValue(row[column.name]);
                const display =
                  full.length > PREVIEW_DISPLAY_MAX
                    ? full.slice(0, PREVIEW_DISPLAY_MAX) + "…"
                    : full;
                return (
                  <td
                    key={column.name}
                    style={previewCellStyle({ isExpandable: full.length > 0 })}
                    title={full ? "Double-click to expand" : undefined}
                    onDoubleClick={
                      full ? () => setExpandedValue(full) : undefined
                    }
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ExpandedTextDialog
        open={!!expandedValue}
        onOpenChange={(open) => {
          if (!open) setExpandedValue(undefined);
        }}
        textExpanded={expandedValue}
      />
    </>
  );
}

const previewHeaderStyle = ({
  width,
}: {
  width?: number;
}): React.CSSProperties => ({
  position: "sticky",
  top: 0,
  zIndex: 1,
  background: "var(--chakra-colors-bg-subtle)",
  borderBottom: "1px solid var(--chakra-colors-border-muted)",
  borderRight: "1px solid var(--chakra-colors-border-muted)",
  padding: "4px 8px",
  textAlign: "left",
  fontWeight: 600,
  whiteSpace: "nowrap",
  width,
  minWidth: width,
});

const checkboxInputStyle: React.CSSProperties = {
  margin: 0,
  cursor: "pointer",
  verticalAlign: "middle",
};

/** Checkbox column cell, centered on both axes so rows line up with the header. */
const previewCheckboxCellStyle = ({
  header,
}: {
  header?: boolean;
}): React.CSSProperties => ({
  ...(header
    ? {
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--chakra-colors-bg-subtle)",
      }
    : {}),
  borderBottom: "1px solid var(--chakra-colors-border-muted)",
  borderRight: "1px solid var(--chakra-colors-border-muted)",
  padding: "4px 8px",
  width: 46,
  minWidth: 46,
  textAlign: "center",
  verticalAlign: "middle",
});

const previewCellStyle = ({
  width,
  muted,
  isExpandable,
}: {
  width?: number;
  muted?: boolean;
  isExpandable?: boolean;
}): React.CSSProperties => ({
  borderBottom: "1px solid var(--chakra-colors-border-muted)",
  borderRight: "1px solid var(--chakra-colors-border-muted)",
  padding: "4px 8px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "260px",
  verticalAlign: "middle",
  width,
  minWidth: width,
  color: muted ? "var(--chakra-colors-fg-muted)" : undefined,
  cursor: isExpandable ? "pointer" : undefined,
});
