import { createContext } from "react";

/** "fit" is width 1% and nowrap; a number is px. A small number is never handed to Chakra raw. */
export type ColumnWidth = "fit" | number | `${number}px` | `${number}%` | `${number}rem`;

/** Instrumentation: `data-*` is the one thing every part forwards besides its own props. */
export type DataAttributes = { [K in `data-${string}`]?: string | number | boolean | undefined };

/** The `data-*` attributes of a props object, and nothing else. */
export function dataAttributes(props: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")));
}

/** What `sizing` accepts: a ColumnWidth, or a plain CSS length string from an older caller. */
type Width = string | number;
type SizingInput = { width?: Width; minWidth?: Width; maxWidth?: Width };

function lengthOf(value: Width): string {
  if (value === "fit") return "1%";
  return typeof value === "number" ? `${value}px` : value;
}

/** Width, min and max as CSS lengths; "fit" also keeps the cell on one line. */
export function sizing({ width, minWidth, maxWidth }: SizingInput) {
  return {
    ...(width === undefined ? {} : { width: lengthOf(width) }),
    ...(minWidth === undefined ? {} : { minWidth: lengthOf(minWidth) }),
    ...(maxWidth === undefined ? {} : { maxWidth: lengthOf(maxWidth) }),
    ...(width === "fit" ? { whiteSpace: "nowrap" as const } : {}),
  };
}

/** What a row shares with the parts inside it: one gate for a disabled row. */
export const RowContext = createContext({ disabled: false });

/** Marks a cell whose clicks never reach the row's `onActivate`. */
export const STOP_ROW = { "data-stop-row-activation": "" } as const;

/** What the row handler leaves to the element itself. */
export const CONTROLS =
  'a, button, input, select, textarea, summary, label, [contenteditable]:not([contenteditable="false"]), [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="button"], [role="link"], [role="checkbox"]';
