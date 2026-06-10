/**
 * Lightweight read-only table for dataset previews: row numbers, stringified
 * values, compact rows. Used by the dataset preview cards and the
 * add-to-dataset mapping preview (which adds a selection checkbox column via
 * `selectable`).
 */
import { Checkbox } from "@chakra-ui/react";
import { useMemo } from "react";

import type { DatasetColumns } from "~/server/datasets/types";

type PreviewRow = { id?: string; selected?: boolean } & Record<
  string,
  unknown
>;

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

  const allSelected =
    selectable && rows.length > 0 && rows.every((row) => !!row.selected);

  return (
    <table
      data-testid="dataset-preview-table"
      style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}
    >
      <thead>
        <tr>
          {selectable ? (
            <th style={previewHeaderStyle({ width: 46 })}>
              <Checkbox.Root
                size="sm"
                aria-label="Select all rows"
                checked={allSelected}
                onCheckedChange={({ checked }) =>
                  onToggleAll?.(checked === true)
                }
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
              </Checkbox.Root>
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
              <td style={previewCellStyle({ width: 46 })}>
                <Checkbox.Root
                  size="sm"
                  aria-label={`Select row ${rowIndex + 1}`}
                  checked={!!row.selected}
                  onCheckedChange={({ checked }) =>
                    onToggleRow?.(rowIndex, checked === true)
                  }
                >
                  <Checkbox.HiddenInput />
                  <Checkbox.Control />
                </Checkbox.Root>
              </td>
            ) : (
              <td style={previewCellStyle({ width: 48, muted: true })}>
                {rowIndex + 1}
              </td>
            )}
            {visibleColumns.map((column) => (
              <td key={column.name} style={previewCellStyle({})}>
                {stringifyPreviewValue(row[column.name])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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

const previewCellStyle = ({
  width,
  muted,
}: {
  width?: number;
  muted?: boolean;
}): React.CSSProperties => ({
  borderBottom: "1px solid var(--chakra-colors-border-muted)",
  borderRight: "1px solid var(--chakra-colors-border-muted)",
  padding: "4px 8px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "260px",
  width,
  minWidth: width,
  color: muted ? "var(--chakra-colors-fg-muted)" : undefined,
});
