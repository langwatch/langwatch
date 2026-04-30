import { Box } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useMemo } from "react";
import { removeNodeAtLocation } from "~/server/app-layer/traces/query-language/mutations";
import { buildDecorationPlan, type TokenRef } from "./filterHighlight";

const PLACEHOLDER_TEXT = "Search filters, free text, or Ask AI…";

type DecoratedSegment =
  | { kind: "text"; text: string; className?: string }
  | { kind: "delete"; token: TokenRef };

/**
 * Slice the query into segments matching the decoration plan, so the
 * placeholder mirrors the same syntax-highlighted look as the live editor —
 * including the per-token delete (X) widgets that the live editor renders
 * via ProseMirror decorations. Without these, an existing query loaded
 * fresh shows styled tokens but no remove affordance until the user
 * clicks into the bar (which mounts the real editor); the placeholder
 * looked half-functional in that interim.
 *
 * Segments without a className render as plain text; segments of kind
 * `delete` render as a token-X button using the same `.filter-token-delete`
 * styling as the live widget so the visual hand-off is invisible.
 */
function buildSegments(text: string): DecoratedSegment[] {
  if (!text) return [];
  const plan = buildDecorationPlan(text);
  // Sort slots by `from` so we can splice the original text linearly.
  const slots = [...plan.slots].sort((a, b) => a.from - b.from);
  // Index tokens by their `end` position so we can drop a delete button
  // immediately after the slot that closes the token. Tokens are produced
  // off the parsed AST while slots come from a regex fallback when the
  // parse fails — they don't always agree on absolute offsets, so we
  // match by adjacency to the slot end rather than by absolute index.
  const tokenAtEnd = new Map<number, TokenRef>();
  for (const tok of plan.tokens) {
    // `plan.leadingWs` is the whitespace stripped before parse — adjust
    // back into the original text's coordinate space.
    tokenAtEnd.set(tok.end + plan.leadingWs, tok);
  }
  const out: DecoratedSegment[] = [];
  let cursor = 0;
  const pushTextChunk = (from: number, to: number) => {
    if (to <= from) return;
    out.push({ kind: "text", text: text.slice(from, to) });
  };
  for (const slot of slots) {
    if (slot.from < cursor) continue; // overlap (rare); skip
    pushTextChunk(cursor, slot.from);
    out.push({
      kind: "text",
      text: text.slice(slot.from, slot.to),
      className: slot.className,
    });
    const token = tokenAtEnd.get(slot.to);
    if (token) {
      out.push({ kind: "delete", token });
    }
    cursor = slot.to;
  }
  pushTextChunk(cursor, text.length);
  return out;
}

interface PlaceholderEditorProps {
  queryText: string;
  onActivate: () => void;
  onApplyQueryText: (text: string) => void;
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
  onApplyQueryText,
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
        : segments.map((seg, i) => {
            if (seg.kind === "delete") {
              const { token } = seg;
              return (
                <button
                  // Mirrors the live editor's widget exactly so the visual
                  // hand-off when the placeholder swaps for the live
                  // editor reads as a no-op rather than a re-render.
                  key={`del-${i}-${token.start}-${token.end}`}
                  type="button"
                  className="filter-token-delete"
                  aria-label="Remove this filter"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    // mousedown beats onFocus + onActivate so the editor
                    // doesn't mount mid-click. Stops the placeholder's
                    // own onMouseDown from firing the activator at the
                    // same time.
                    event.preventDefault();
                    event.stopPropagation();
                    const next = removeNodeAtLocation(
                      queryText,
                      token.start,
                      token.end,
                    );
                    onApplyQueryText(next);
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <line x1="2" y1="2" x2="8" y2="8" />
                    <line x1="8" y1="2" x2="2" y2="8" />
                  </svg>
                </button>
              );
            }
            return seg.className ? (
              <span key={i} className={seg.className}>
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            );
          })}
    </Box>
  );
};
