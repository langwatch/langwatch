import { Box } from "@chakra-ui/react";
import type { SystemStyleObject } from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { buildDecorationPlan } from "./filterHighlight";

interface QueryPreviewProps {
  query: string;
  /** Smaller variant for inline contexts. */
  size?: "sm" | "md";
}

interface Segment {
  text: string;
  className?: string;
}

/**
 * Renders a query string with the same coloured token decoration used by the
 * live search bar — keeps the docs and the editor visually in lockstep.
 *
 * Reuses `buildDecorationPlan` from the editor's highlight extension so the
 * docs can never drift from what `liqe` actually parses.
 */
export const QueryPreview: React.FC<QueryPreviewProps> = ({
  query,
  size = "sm",
}) => {
  const segments = useMemo(() => buildSegments(query), [query]);

  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      flexWrap="wrap"
      gap="2px"
      fontFamily="mono"
      fontSize={size === "sm" ? "xs" : "sm"}
      lineHeight="1.6"
      css={previewTokenStyles}
    >
      {segments.map((seg, idx) => (
        <span key={idx} className={seg.className}>
          {seg.text}
        </span>
      ))}
    </Box>
  );
};

function buildSegments(query: string): Segment[] {
  const trimmed = query;
  if (!trimmed) return [];
  const plan = buildDecorationPlan(trimmed);
  const sorted = [...plan.slots].sort((a, b) => a.from - b.from);
  const out: Segment[] = [];
  let cursor = 0;
  for (const slot of sorted) {
    if (slot.from > cursor) {
      out.push({ text: trimmed.slice(cursor, slot.from) });
    }
    out.push({
      text: trimmed.slice(slot.from, slot.to),
      className: slot.className,
    });
    cursor = slot.to;
  }
  if (cursor < trimmed.length) {
    out.push({ text: trimmed.slice(cursor) });
  }
  return out;
}

/**
 * Mirrors the `filter-token*` classes from `editorStyles` so the rendered
 * preview matches the live search-bar tokens. Kept inline rather than imported
 * to avoid pulling in the `& .tiptap` editor scope for documentation contexts.
 */
const previewTokenStyles: SystemStyleObject = {
  "& .filter-token": {
    background: "orange.subtle",
    border: "1px solid",
    borderColor: "orange.muted",
    borderRadius: "4px",
    padding: "0 4px",
  },
  "& .filter-token-exclude": {
    background: "red.subtle",
    borderColor: "red.muted",
  },
  "& .filter-token-scenario": {
    background: "pink.subtle",
    borderColor: "pink.muted",
  },
  "& .filter-keyword": {
    color: "fg.muted",
    fontWeight: "semibold",
    letterSpacing: "0.02em",
    paddingX: "2px",
  },
  "& .filter-keyword-or": { color: "orange.fg" },
  "& .filter-keyword-not": { color: "red.fg" },
  "& .filter-paren": {
    color: "fg.subtle",
    fontWeight: "semibold",
  },
};
