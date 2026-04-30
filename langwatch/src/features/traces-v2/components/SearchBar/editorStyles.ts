import type { SystemStyleObject } from "@chakra-ui/react";

export const editorStyles: SystemStyleObject = {
  "& .tiptap": {
    outline: "none",
    fontFamily: "var(--chakra-fonts-mono)",
    fontSize: "var(--chakra-font-sizes-xs)",
    lineHeight: "24px",
    whiteSpace: "nowrap",
    overflowX: "auto",
    overflowY: "hidden",
    caretColor: "var(--chakra-colors-fg-DEFAULT)",
  },
  "& .tiptap p": { margin: 0 },
  "& .tiptap p.is-editor-empty:first-child::before": {
    color: "var(--chakra-colors-fg-subtle)",
    content: "attr(data-placeholder)",
    float: "left",
    height: 0,
    pointerEvents: "none",
  },
  // Left half of the chip — the X widget styled by `.filter-token-delete`
  // is the right half. Together they read as one piece: the token drops its
  // right border + right radius, the button picks them up with a matching
  // separator on its left edge. `whiteSpace: nowrap` on the chunk + a
  // sub-pixel negative margin on the button (below) keep the two halves
  // visually glued so the X can't detach when the editor scrolls or the
  // browser sub-pixel-rounds adjacent inline elements.
  "& .filter-token": {
    display: "inline-flex",
    alignItems: "center",
    height: "23px",
    lineHeight: "22px",
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    background: "blue.subtle",
    borderTop: "1px solid",
    borderBottom: "1px solid",
    borderLeft: "1px solid",
    borderColor: "blue.solid",
    borderTopLeftRadius: "8px",
    borderBottomLeftRadius: "8px",
    paddingLeft: "6px",
    // Breathing room before the X widget — without this the value text
    // crashed into the chip's right border, so the close button looked
    // glued onto the value (`origin:agent×` instead of `origin:agent  ×`).
    paddingRight: "6px",
    marginLeft: "1px",
  },
  // Field name was unrecognised (typo, removed key) — still parses as a
  // tag but the rest of the platform won't filter on it. A warning tint
  // makes that visible without rejecting the query outright.
  "& .filter-token-unknown-field": {
    background: "yellow.subtle",
    borderColor: "yellow.muted",
    borderStyle: "dashed",
  },
  "& .filter-token-exclude": {
    background: "red.subtle",
    borderColor: "red.muted",
  },
  "& .filter-token-scenario": {
    background: "purple.subtle",
    borderColor: "purple.muted",
  },
  "& .filter-token-numeric": {
    background: "green.subtle",
    borderColor: "green.muted",
  },
  "& .filter-keyword": {
    color: "fg.muted",
    fontWeight: "semibold",
    letterSpacing: "0.02em",
  },
  "& .filter-keyword-or": {
    color: "orange.fg",
  },
  "& .filter-keyword-not": {
    color: "red.fg",
  },
  "& .filter-paren": {
    color: "fg.subtle",
    fontWeight: "semibold",
  },
  // Right half of the chip — flush against the token, full chip height,
  // rounded only on the right side. Variant tints are mirrored from the
  // adjacent token via sibling selectors so the two halves match.
  // `marginLeft: -1px` overlaps the button's left border with the token's
  // right edge, so any sub-pixel gap from inline-flow rounding closes
  // visually — the X always reads as the right side of the same chip.
  "& .filter-token-delete": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "23px",
    paddingLeft: "2px",
    paddingRight: 0,
    background: "blue.subtle",
    borderTop: "1px solid",
    borderBottom: "1px solid",
    borderRight: "1px solid",
    borderLeft: "1px solid",
    borderColor: "blue.solid",
    borderTopRightRadius: "8px",
    borderBottomRightRadius: "8px",
    color: "fg.muted",
    cursor: "pointer",
    marginLeft: "-1px",
    marginRight: "1px",
    whiteSpace: "nowrap",
    transition: "background-color 100ms ease-out, color 100ms ease-out",
    verticalAlign: "middle",
    userSelect: "none",
    pointerEvents: "auto",
  },
  "& .filter-token-exclude + .filter-token-delete": {
    background: "red.subtle",
    borderColor: "red.muted",
  },
  "& .filter-token-scenario + .filter-token-delete": {
    background: "purple.subtle",
    borderColor: "purple.muted",
  },
  "& .filter-token-numeric + .filter-token-delete": {
    background: "green.subtle",
    borderColor: "green.muted",
  },
  "& .filter-token-unknown-field + .filter-token-delete": {
    background: "yellow.subtle",
    borderColor: "yellow.muted",
    borderStyle: "dashed",
  },
  // Word-shaped tokens that look like operator typos (AMD instead of AND,
  // ANY/BUT/NAND, etc.) — the parser silently treats them as implicit
  // search text, so we surface them visually so the user spots the typo.
  "& .filter-keyword-invalid": {
    color: "red.fg",
    fontWeight: "semibold",
    textDecoration: "underline wavy",
    textDecorationColor: "var(--chakra-colors-red-fg)",
    textUnderlineOffset: "3px",
  },
  "& .filter-token-delete:hover": {
    background: "red.subtle",
    borderColor: "red.muted",
    color: "red.fg",
  },
  "& .filter-token-delete:active": {
    background: "red.muted",
    borderColor: "red.muted",
    color: "red.fg",
  },
};
