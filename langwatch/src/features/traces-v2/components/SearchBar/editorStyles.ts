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
    padding: "0px 4px",
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
  // X overlaps the chip's right edge — no reserved padding so neighbouring
  // text doesn't get pushed around. Absolute-positioned inside the chip's
  // own bounding box so it visually belongs to the colour blob, can hover
  // over a following character without affecting layout.
  "& .filter-token-delete": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "14px",
    height: "14px",
    marginLeft: "-14px",
    marginRight: "0px",
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
    opacity: 0,
    transition: "opacity 80ms ease-out, background 80ms ease-out",
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
