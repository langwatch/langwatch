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
  "& .filter-token": {
    display: "inline-flex",
    alignItems: "center",
    height: "23px",
    lineHeight: "22px",
    verticalAlign: "middle",
    background: "blue.subtle",
    border: "1px solid",
    borderColor: "blue.solid",
    borderRadius: "8px",
    padding: "0 22px 0 4px",
    margin: "0 1px",
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
  // The X tucks into the right-edge well reserved by `.filter-token`'s
  // 22px right padding. Circular hit target, no border (the previous
  // half-border made the chip's right corner look frayed), opacity-faded
  // until the chip is hovered, red wash on its own hover.
  "& .filter-token-delete": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    height: "14px",
    marginLeft: "-18px",
    marginRight: "4px",
    padding: 0,
    border: "none",
    borderRadius: "999px",
    background: "transparent",
    color: "fg.muted",
    cursor: "pointer",
    opacity: 0,
    transition:
      "opacity 100ms ease-out, background-color 100ms ease-out, color 100ms ease-out",
    verticalAlign: "middle",
    userSelect: "none",
    pointerEvents: "auto",
  },
  "& .filter-token:hover + .filter-token-delete, & .filter-token-delete:hover":
    {
      opacity: 1,
    },
  "& .filter-token-delete:hover": {
    background: "red.subtle",
    color: "red.fg",
  },
  "& .filter-token-delete:active": {
    background: "red.muted",
    color: "red.fg",
  },
};
