/**
 * Shared utilities for batch evaluation result tables
 */
import type { SystemStyleObject } from "@langwatch/design-system/primitives";

import { getImageUrl } from "./presentation.tsx";

/**
 * Calculate minimum table width based on column counts
 * Row number (40) + dataset cols (210 each) + target cols (300 each)
 * + comparison winner cols (240 each — see ComparisonWinnerCell).
 */
export const calculateMinTableWidth = (
  datasetColCount: number,
  targetColCount: number,
  comparisonColCount = 0,
): number => {
  return 40 + datasetColCount * 210 + targetColCount * 300 + comparisonColCount * 240;
};

/**
 * What the batch tables add to ListTable: a minimum width so wide runs scroll sideways, cells
 * aligned to the top of tall outputs, a narrow row-number column, and cell actions on hover.
 */
export const getTableStyles = (minTableWidth: number): SystemStyleObject => ({
  "& table": {
    minWidth: `${minTableWidth}px`,
  },
  "& td": {
    verticalAlign: "top",
    textStyle: "bodySm",
  },
  // First column (row number) should stay small
  "& td:first-of-type": {
    minWidth: "40px",
    width: "40px",
  },
  "& tr:hover td": {
    background: "var(--chakra-colors-bg-muted)",
  },
  "& td:hover .cell-action-btn": {
    opacity: 1,
  },
});

/**
 * Infer column type from a value for display purposes.
 * Handles native types and string-encoded values (booleans, numbers, images).
 */
export const inferColumnType = (value: unknown): string => {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "object") {
    return isChatMessageList(value) ? "chat_messages" : "json";
  }
  if (typeof value === "string") return inferStringColumnType(value.trim());
  return "string";
};

const isChatMessageList = (value: object): boolean => {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first: unknown = value[0];
  // Must verify first element is actually an object before using 'in' operator
  if (typeof first !== "object" || first === null) return false;
  return "role" in first;
};

const inferStringColumnType = (trimmed: string): string => {
  if (trimmed === "") return "string";
  if (getImageUrl(trimmed)) return "image";
  if (trimmed === "true" || trimmed === "false") return "boolean";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return "number";
  return "string";
};
