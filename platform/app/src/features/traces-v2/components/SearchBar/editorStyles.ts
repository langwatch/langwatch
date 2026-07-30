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
    // Hard cap on editor height regardless of what made it past the
    // paste sanitizer. Without this, a stray multi-paragraph state
    // (whitespace-only newline that survives normalisation, or schema
    // expansion in future) pushes the rest of the page off-screen.
    maxHeight: "96px",
    caretColor: "var(--chakra-colors-fg)",
  },
  "& .tiptap p": { margin: 0 },
  "& .tiptap p.is-editor-empty:first-of-type::before": {
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
  // Label collapse: when a chip carries a human-readable `label`, render the
  // field-qualified label (`evaluator:Policy Check`) as in-flow ::after text
  // and collapse the underlying id to zero width (font-size:0). The chip then
  // hugs the *label*, not the longer id — no spare space reserved for the
  // value tail. The id stays in the DOM (selection / copy / the query
  // language all keep it) and returns to full size on hover, where the label
  // hides and the chip grows in place to reveal the full id. The `evaluator:`
  // prefix is part of both the label and the id, so it never moves — only the
  // value tail differs.
  "& .filter-token[data-filter-chip-label]": {
    fontSize: "0px",
  },
  "& .filter-token[data-filter-chip-label]::after": {
    content: "attr(data-filter-chip-label)",
    color: "blue.fg",
    fontFamily: "inherit",
    fontSize: "var(--chakra-font-sizes-xs)",
    lineHeight: "22px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  // Reveal the underlying id on hover — also when the X-button half is
  // hovered, so the whole pill reads consistently. Restore the id text to
  // full size and drop the label so only the id shows; the chip grows to fit.
  "& .filter-token[data-filter-chip-label]:hover, & .filter-token[data-filter-chip-label]:has(+ .filter-token-delete:hover)":
    {
      fontSize: "var(--chakra-font-sizes-xs)",
    },
  "& .filter-token[data-filter-chip-label]:hover::after, & .filter-token[data-filter-chip-label]:has(+ .filter-token-delete:hover)::after":
    {
      display: "none",
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
  // AND/OR keyword tokens are clickable in place — clicking cycles the
  // operator. Show a subtle underline + pointer so users discover the
  // affordance without a tooltip-only hint.
  "& .filter-keyword-clickable": {
    cursor: "pointer",
    borderRadius: "2px",
    marginX: "2px",
    transition: "background 80ms ease, color 80ms ease",
  },
  "& .filter-keyword-clickable:hover": {
    background: "bg.muted",
    textDecoration: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
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
    width: "20px",
    height: "23px",
    paddingLeft: "2px",
    paddingRight: "2px",
    background: "blue.subtle",
    borderTop: "1px solid",
    borderBottom: "1px solid",
    borderRight: "1px solid",
    // Intentionally NO borderLeft — the left half of the chip
    // (`.filter-token`) paints its own right edge is omitted by design,
    // and `marginLeft: -1px` here visually butts the two halves
    // together. Adding a left border draws a faint inner divider that
    // becomes obvious on hover when both halves take on the red.muted
    // tint, looking like a misaligned middle stripe.
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
  // Back-propagate hover from the X button onto the left half of the chip
  // so the whole pill reads "about to delete" — without this the variant
  // tint (green for numeric, purple for scenario, etc.) stayed on the
  // left half while only the X button turned red, which made the hover
  // state look broken.
  "& .filter-token:has(+ .filter-token-delete:hover)": {
    background: "red.subtle",
    borderColor: "red.muted",
  },
  "& .filter-token:has(+ .filter-token-delete:active)": {
    background: "red.muted",
    borderColor: "red.muted",
  },
};
