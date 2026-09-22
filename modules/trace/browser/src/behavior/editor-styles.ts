import type { SystemStyleObject } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";

// Emitted through emotion's helper rather than an `"@keyframes …"` key:
// `SystemStyleObject` has no such key, and a plain object never reaches the
// document head, so the animation would name a rule that does not exist.
const instantEvalGlow = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--chakra-colors-green-solid) 28%, transparent);
  }
  50% {
    box-shadow: 0 0 12px 2px color-mix(in srgb, var(--chakra-colors-green-solid) 55%, transparent);
  }
`;

/** Both halves of an `eval` chip: the token and the remove button beside it. */
const INSTANT_EVAL_CHIP =
  "& .filter-token-eval, & .filter-token-delete[data-filter-chip-field='eval'], & .filter-token-delete[data-filter-chip-field^='eval.']";
const BUSY_INSTANT_EVAL_CHIP =
  "&[data-instant-eval-busy] .filter-token-eval, &[data-instant-eval-busy] .filter-token-delete[data-filter-chip-field='eval'], &[data-instant-eval-busy] .filter-token-delete[data-filter-chip-field^='eval.']";

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
  // Left half of the chip — the X widget styled by `.filter-token-delete` is the right
  // half. Together they read as one piece: the token drops its right border + right
  // radius, the button picks them up with a matching separator on its left edge.
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
  // Label collapse: render label as ::after, collapse id to zero width.
  // Tooltip surfaces id without layout changes or hover-induced resize.
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
  // An Instant Eval chip carries a judgement rather than a field match, so it
  // wears a fuller green than the blue field chips around it. The remove button
  // is matched by its own field attribute rather than as a sibling: in the live
  // editor it is a ProseMirror widget.
  [INSTANT_EVAL_CHIP]: {
    background: "green.muted",
    borderColor: "green.solid",
  },
  "& .filter-token-eval[data-filter-chip-label]::after": {
    color: "green.fg",
  },
  // While its run is estimated, started or judging, the chip breathes a green
  // halo, the same affordance the ask button wears, at a quicker pace because
  // this one ends.
  [BUSY_INSTANT_EVAL_CHIP]: {
    animation: `${instantEvalGlow} 1.2s ease-in-out infinite`,
  },
  "@media (prefers-reduced-motion: reduce)": {
    [BUSY_INSTANT_EVAL_CHIP]: { animation: "none" },
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
  // Right half of the chip — flush against the token, full chip height, rounded only on
  // the right side. Variant tints are mirrored from the adjacent token via sibling
  // selectors so the two halves match.
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
    // Intentionally NO borderLeft — the left half of the chip (`.filter-token`) paints
    // its own right edge is omitted by design, and `marginLeft: -1px` here visually
    // butts the two halves together.
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
