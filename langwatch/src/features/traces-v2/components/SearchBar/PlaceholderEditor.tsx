import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useMemo } from "react";
import { buildDecorationPlan } from "./filterHighlight";

const PLACEHOLDER_TEXT = "Search filters, free text, or Ask AI…";

interface DecoratedSegment {
  text: string;
  className?: string;
}

/**
 * Slice the query into segments matching the decoration plan, so the
 * placeholder mirrors the same syntax-highlighted look as the live editor.
 * Segments without a className render as plain text. Sigh-of-relief
 * substitution keeps decorations visible even when the user clicks away.
 */
function buildSegments(text: string): DecoratedSegment[] {
  if (!text) return [];
  const plan = buildDecorationPlan(text);
  // Sort slots by `from` so we can splice the original text linearly.
  const slots = [...plan.slots].sort((a, b) => a.from - b.from);
  const out: DecoratedSegment[] = [];
  let cursor = 0;
  for (const slot of slots) {
    if (slot.from < cursor) continue; // overlap (rare); skip
    if (slot.from > cursor) {
      out.push({ text: text.slice(cursor, slot.from) });
    }
    out.push({
      text: text.slice(slot.from, slot.to),
      className: slot.className,
    });
    cursor = slot.to;
  }
  if (cursor < text.length) {
    out.push({ text: text.slice(cursor) });
  }
  return out;
}

interface PlaceholderEditorProps {
  queryText: string;
  onActivate: () => void;
}

/**
 * Lightweight stand-in for the TipTap-backed editor. Mounted on cold load to
 * avoid the ~270ms ProseMirror init reflow. Activates (and tears itself down)
 * on first focus, click, or `/` keystroke — the parent then mounts the real
 * editor and forwards focus to it.
 */
export const PlaceholderEditor: React.FC<PlaceholderEditorProps> = ({
  queryText,
  onActivate,
}) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      onActivate();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onActivate]);

  const isEmpty = queryText.length === 0;
  const segments = useMemo(() => buildSegments(queryText), [queryText]);

  return (
    <Box
      tabIndex={0}
      role="textbox"
      aria-label={PLACEHOLDER_TEXT}
      data-placeholder={PLACEHOLDER_TEXT}
      onFocus={onActivate}
      onMouseDown={onActivate}
      fontFamily="var(--chakra-fonts-mono)"
      fontSize="var(--chakra-font-sizes-xs)"
      lineHeight="1.5"
      outline="none"
      whiteSpace="nowrap"
      overflow="hidden"
      cursor="text"
      color={isEmpty ? "fg.subtle" : undefined}
    >
      {isEmpty
        ? PLACEHOLDER_TEXT
        : segments.map((seg, i) =>
            seg.className ? (
              <span key={i} className={seg.className}>
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
    </Box>
  );
};
