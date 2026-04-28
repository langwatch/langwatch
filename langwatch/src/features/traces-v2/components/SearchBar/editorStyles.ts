import type { SystemStyleObject } from "@chakra-ui/react";

export const editorStyles: SystemStyleObject = {
  "& .tiptap": {
    outline: "none",
    fontFamily: "var(--chakra-fonts-mono)",
    fontSize: "var(--chakra-font-sizes-xs)",
    lineHeight: "1.5",
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
    background:
      "color-mix(in srgb, var(--chakra-colors-blue-500) 14%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--chakra-colors-blue-500) 22%, transparent)",
    borderRadius: "4px",
    padding: "0px 4px",
    margin: "0 1px",
  },
  "& .filter-token-exclude": {
    background:
      "color-mix(in srgb, var(--chakra-colors-red-500) 14%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--chakra-colors-red-500) 22%, transparent)",
  },
  "& .filter-token-scenario": {
    background:
      "color-mix(in srgb, var(--chakra-colors-purple-500) 14%, transparent)",
    border:
      "1px solid color-mix(in srgb, var(--chakra-colors-purple-500) 28%, transparent)",
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
  "& .filter-token-delete": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    height: "14px",
    marginLeft: "2px",
    padding: 0,
    border: "none",
    borderRadius: "3px",
    background: "transparent",
    color: "fg.muted",
    fontSize: "13px",
    fontWeight: "bold",
    lineHeight: 1,
    cursor: "pointer",
    opacity: 0,
    transition: "opacity 80ms ease-out, background 80ms ease-out",
    verticalAlign: "middle",
    userSelect: "none",
  },
  "& .filter-token:hover + .filter-token-delete, & .filter-token-delete:hover":
    {
      opacity: 1,
    },
  "& .filter-token-delete:hover": {
    background: "red.500/15",
    color: "red.fg",
  },
};
