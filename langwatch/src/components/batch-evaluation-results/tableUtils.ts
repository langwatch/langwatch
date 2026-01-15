/**
 * Shared utilities for batch evaluation result tables
 */
import type { SystemStyleObject } from "@chakra-ui/react";

/** Estimated row height for virtualization */
export const ROW_HEIGHT = 180;

/**
 * Calculate minimum table width based on column counts
 * Row number (40) + dataset cols (210 each) + target cols (300 each)
 */
export const calculateMinTableWidth = (
  datasetColCount: number,
  targetColCount: number
): number => {
  return 40 + datasetColCount * 210 + targetColCount * 300;
};

/**
 * Shared table styling used by both single run and comparison tables
 */
export const getTableStyles = (minTableWidth: number): SystemStyleObject => ({
  "& table": {
    width: "100%",
    minWidth: `${minTableWidth}px`,
    borderCollapse: "collapse",
  },
  "& th": {
    position: "sticky",
    top: 0,
    background: "white",
    borderBottom: "1px solid var(--chakra-colors-gray-200)",
    padding: "8px 12px",
    textAlign: "left",
    fontSize: "12px",
    fontWeight: "600",
    color: "var(--chakra-colors-gray-600)",
    whiteSpace: "nowrap",
    zIndex: 1,
  },
  "& td": {
    borderBottom: "1px solid var(--chakra-colors-gray-100)",
    padding: "12px",
    verticalAlign: "top",
    fontSize: "13px",
    // Setting height: 1px on td establishes a height context
    // This allows children to use height: 100% correctly
    height: "1px",
  },
  // Make cell content stretch to fill available height
  "& td > div": {
    height: "100%",
  },
  // First column (row number) should stay small
  "& td:first-of-type": {
    minWidth: "40px",
    width: "40px",
  },
  "& tr:hover td": {
    background: "var(--chakra-colors-gray-50)",
  },
  "& td:hover .cell-action-btn": {
    opacity: 1,
  },
});

/**
 * Infer column type from a value for display purposes
 */
export const inferColumnType = (value: unknown): string => {
  if (value === null || value === undefined) return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "object") {
    // Must verify first element is actually an object before using 'in' operator
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null &&
      "role" in value[0]
    ) {
      return "chat_messages";
    }
    return "json";
  }
  return "string";
};
