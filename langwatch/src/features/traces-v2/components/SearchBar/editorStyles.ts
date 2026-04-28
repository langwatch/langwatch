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
    background: "blue.subtle",
    border: "1px solid",
    borderColor: "blue.muted",
    borderRadius: "4px",
    padding: "0 16px 0 4px",
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
  // X sits inside the right-edge well reserved by `.filter-token`'s 16px
  // right padding. Hidden by default, shows on chip hover, intensifies to
  // a red destructive tint on its own hover.
  "& .filter-token-delete": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    height: "16px",
    marginLeft: "-15px",
    marginRight: "1px",
    padding: 0,
    border: "none",
    borderTopRightRadius: "3px",
    borderBottomRightRadius: "3px",
    background: "transparent",
    color: "fg.muted",
    fontSize: "13px",
    fontWeight: "bold",
    lineHeight: 1,
    cursor: "pointer",
    opacity: 0.35,
    transition: "opacity 80ms ease-out, background 80ms ease-out, color 80ms ease-out",
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
};
