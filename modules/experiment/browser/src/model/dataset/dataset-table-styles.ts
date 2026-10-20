import type { SystemStyleObject } from "@langwatch/design-system/primitives";

/** Firmer line where a section ends: header base, section edges and the grid's frame. */
export const WORKBENCH_SECTION_BORDER = "border";
export const SECTION_LINE = "1px solid var(--chakra-colors-border)";
/** Hairline between cells and columns; the one grid-line colour. */
export const GRID_LINE = "1px solid var(--chakra-colors-border-muted)";

/**
 * Cell/row styling shared by every dataset table surface, applied via
 * `css` on the scroll container — the source of truth for bare `<td>`/`<th>`
 * borders, padding and hover. Hosts layer column-width, sticky-header on top.
 */
export const datasetTableCss: SystemStyleObject = {
  "& th": {
    borderBottom: SECTION_LINE,
    borderRight: GRID_LINE,
    padding: "8px 12px",
    textAlign: "left",
    backgroundColor: "var(--chakra-colors-bg-panel)",
    textStyle: "label",
    position: "relative",
  },
  "& td": {
    borderBottom: GRID_LINE,
    borderRight: GRID_LINE,
    padding: "8px 12px",
    textStyle: "bodySm",
    verticalAlign: "top",
    "--cell-bg": "var(--chakra-colors-bg-panel)",
  },
  "& tr:hover td": {
    backgroundColor: "var(--chakra-colors-bg-subtle)",
    "--cell-bg": "var(--chakra-colors-bg-subtle)",
  },
  "& tr[data-selected='true'] td": {
    backgroundColor: "var(--chakra-colors-blue-subtle)",
    "--cell-bg": "var(--chakra-colors-blue-subtle)",
    borderColor: "var(--chakra-colors-blue-muted)",
  },
  "& tr:has(+ tr[data-selected='true']) td": {
    borderBottomColor: "var(--chakra-colors-blue-muted)",
  },
};
