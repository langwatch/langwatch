import type { SystemStyleObject } from "@chakra-ui/react";

/**
 * Cell/row styling shared by every dataset table surface, applied via
 * `css` on the scroll container — the source of truth for bare `<td>`/`<th>`
 * borders, padding and hover. Hosts layer column-width, sticky-header on top.
 */
export const datasetTableCss: SystemStyleObject = {
  "& th": {
    borderBottom: "1px solid var(--chakra-colors-border)",
    borderRight: "1px solid var(--chakra-colors-border-muted)",
    padding: "8px 12px",
    textAlign: "left",
    backgroundColor: "var(--chakra-colors-bg-panel)",
    fontWeight: "medium",
    fontSize: "13px",
    position: "relative",
  },
  "& td": {
    borderBottom: "1px solid var(--chakra-colors-border-muted)",
    borderRight: "1px solid var(--chakra-colors-border-muted)",
    padding: "8px 12px",
    fontSize: "13px",
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
