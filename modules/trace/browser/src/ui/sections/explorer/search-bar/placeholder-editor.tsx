import { Box } from "@chakra-ui/react";
import { removeNodeAtLocation, swapOperatorAtLocation } from "@langwatch/trace-contract";
import type React from "react";
import { useEffect, useMemo } from "react";

import {
  buildDecorationPlan,
  chipOverlayLabel,
  type TokenRef,
} from "../../../../behavior/explorer/search-bar/filter-highlight.ts";
import { useFacetValueLabelResolver } from "../hooks/use-facet-value-labels.ts";

/**
 * The search bar's at-rest invitation. One constant, so the cold placeholder
 * here and the live editor's can never drift; it names both things Enter takes,
 * and the ask button, not the placeholder, is the way to Langy.
 */
export const SEARCH_BAR_PLACEHOLDER = "Search filters or type what you are looking for";

type DecoratedSegment =
  | {
      kind: "text";
      text: string;
      className?: string;
      /**
       * Liqe-text-coordinate range for AND/OR operator segments. Set when the slot
       * wraps a BooleanOperator so the placeholder's click handler can flip the keyword
       * in place — same affordance the live ProseMirror editor exposes.
       */
      opLoc?: { start: number; end: number };
      /**
       * For categorical chip segments, the parsed token info — the
       * placeholder uses this to fire a value-picker popover when the
       * chip is clicked.
       */
      token?: TokenRef;
    }
  | { kind: "delete"; token: TokenRef };

/**
 * Slice the query into segments matching the decoration plan, so the placeholder
 * mirrors the same syntax-highlighted look as the live editor — including the per-token
 * delete (X) widgets that the live editor renders via ProseMirror decorations.
 */
function buildSegments(text: string): DecoratedSegment[] {
  if (!text) return [];
  const plan = buildDecorationPlan(text);
  // Sort slots by `from` so we can splice the original text linearly.
  const slots = [...plan.slots].toSorted((a, b) => a.from - b.from);
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
    const token = tokenAtEnd.get(slot.to);
    out.push({
      kind: "text",
      text: text.slice(slot.from, slot.to),
      className: slot.className,
      opLoc: slot.opLoc,
      // Only chip slots get a token — operator slots have opLoc, attribute
      // chips have neither. The presence of `token` on a text segment is
      // what tells the click handler "this is a value chip; open the
      // picker with this field/value/location".
      token: token && token.value !== null ? token : undefined,
    });
    if (token) {
      out.push({ kind: "delete", token });
    }
    cursor = slot.to;
  }
  pushTextChunk(cursor, text.length);
  return out;
}

export interface TokenClickPayload {
  /** Bounding rect of the clicked chip — used to anchor a popover. */
  rect: DOMRect;
  field: string;
  currentValue: string;
  /** Liqe-text-coordinate range of the Tag. */
  location: { start: number; end: number };
}

interface PlaceholderEditorProps {
  queryText: string;
  onActivate: () => void;
  onApplyQueryText: (text: string) => void;
  /** Fired when a categorical chip is clicked. The parent opens the
   * value-picker popover; if absent, clicks fall through to the
   * activation behaviour. */
  onTokenClick?: (payload: TokenClickPayload) => void;
}

function DecoratedSegmentView({
  segment,
  index,
  queryText,
  onApplyQueryText,
  onTokenClick,
  resolveLabel,
}: {
  segment: DecoratedSegment;
  index: number;
  queryText: string;
  onApplyQueryText: (text: string) => void;
  onTokenClick: PlaceholderEditorProps["onTokenClick"];
  resolveLabel: ReturnType<typeof useFacetValueLabelResolver>;
}) {
  if (segment.kind === "delete") {
    const { token } = segment;
    return (
      <button
        key={`del-${index}-${token.start}-${token.end}`}
        type="button"
        className="filter-token-delete"
        aria-label="Remove this filter"
        tabIndex={-1}
        data-filter-chip-field={token.field}
        data-filter-chip-value={token.value ?? undefined}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = removeNodeAtLocation({
            currentQuery: queryText,
            start: token.start,
            end: token.end,
          });
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

  if (segment.opLoc) {
    const { start, end } = segment.opLoc;
    return (
      <span
        className={segment.className}
        data-filter-op-start={start}
        data-filter-op-end={end}
        title="Click to switch AND ↔ OR"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = swapOperatorAtLocation({ currentQuery: queryText, start, end });
          if (next !== queryText) onApplyQueryText(next);
        }}
      >
        {segment.text}
      </span>
    );
  }

  const token = segment.token;
  if (token && onTokenClick && token.value !== null) {
    const value = token.value;
    const richLabel = resolveLabel({ field: token.field, value });
    const overlayLabel = chipOverlayLabel({
      field: token.field,
      value,
      label: richLabel,
    });
    return (
      <span
        className={segment.className}
        data-filter-chip-start={token.start}
        data-filter-chip-end={token.end}
        data-filter-chip-field={token.field}
        data-filter-chip-value={value}
        data-filter-chip-label={overlayLabel}
        style={{ cursor: "pointer" }}
        title={
          richLabel ? `${token.field}:${value}, click to change value` : "Click to change value"
        }
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTokenClick({
            rect: event.currentTarget.getBoundingClientRect(),
            field: token.field,
            currentValue: value,
            location: { start: token.start, end: token.end },
          });
        }}
      >
        {segment.text}
      </span>
    );
  }

  if (segment.className) return <span className={segment.className}>{segment.text}</span>;
  return <span>{segment.text}</span>;
}

/**
 * Lightweight stand-in for the TipTap-backed editor. Mounted on cold load to avoid the
 * ~270ms ProseMirror init reflow.
 */
export const PlaceholderEditor: React.FC<PlaceholderEditorProps> = ({
  queryText,
  onActivate,
  onApplyQueryText,
  onTokenClick,
}) => {
  const placeholderText = SEARCH_BAR_PLACEHOLDER;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isTypingTarget) {
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
  // Chips store the raw id (unique) but display the resolved facet label
  // (readable) — same source the sidebar uses. The label is painted by the
  // shared CSS overlay (see editorStyles), field prefix intact; the raw id
  // stays in the tooltip so the chip never resizes under the pointer —
  // identical to the live editor.
  const resolveLabel = useFacetValueLabelResolver();

  return (
    <Box
      tabIndex={0}
      role="textbox"
      aria-label={placeholderText}
      data-placeholder={placeholderText}
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
        ? placeholderText
        : segments.map((segment, index) => (
            <DecoratedSegmentView
              key={`${segment.kind}-${index}`}
              segment={segment}
              index={index}
              queryText={queryText}
              onApplyQueryText={onApplyQueryText}
              onTokenClick={onTokenClick}
              resolveLabel={resolveLabel}
            />
          ))}
    </Box>
  );
};
