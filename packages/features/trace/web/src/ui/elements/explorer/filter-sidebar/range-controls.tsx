import { Input } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

/** Snap to "cleared" when both endpoints are within this fraction of the full range. */
export const CLEAR_EPSILON = 0.01;

/** Strip currency / unit suffixes so users can paste back the formatted
 * label and still get a parseable number. "1.5s" → 1.5, "$0.05" → 0.05,
 * "12,300" → 12300. Returns null for anything that doesn't yield a
 * finite number after the strip. Exported for unit testing — opinionated
 * behaviour is easy to regress otherwise. */
export function parseEditedValue(input: string): number | null {
  // Strip currency, separators, whitespace, and unit letters — but keep
  // `e`/`E` so scientific notation (`1e6`, `2.5E-3`) parses correctly.
  // Without this carve-out a paste like "1e6" became "16".
  const cleaned = input.replace(/[$,\s]|[a-df-zA-DF-Z]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Slider step scaled to the range's span. zag-js defaults `step` to 1 and throws when
 * `max - min < step`, which made sub-unit ranges (cost in dollars: $0 – $0.004) fail to
 * render at all.
 */
export function stepForSpan(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  return 10 ** Math.floor(Math.log10(span / 200));
}

interface CommitRangeParams {
  rawFrom: number;
  rawTo: number;
  min: number;
  max: number;
  span: number;
  onChange: (from: number, to: number) => void;
  onClear: () => void;
}

/**
 * Shared commit path for range filters. Drops NaN / Infinity straight away so we never
 * emit `[NaN TO NaN]` into the URL — zag-js can hand us undefined on degenerate slider
 * states.
 */
export function commitRange({
  rawFrom,
  rawTo,
  min,
  max,
  span,
  onChange,
  onClear,
}: CommitRangeParams): [number, number] | null {
  if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return null;
  // Honour the [min, max] bounds even if the input came from a typed
  // value that overshot the slider range — a 5h duration filter on a
  // project where the slowest trace is 30s should clamp to the
  // observed max rather than fail server-side.
  const lo = Math.max(min, Math.min(rawFrom, rawTo));
  const hi = Math.min(max, Math.max(rawFrom, rawTo));
  const isFullRange =
    Math.abs(lo - min) < span * CLEAR_EPSILON && Math.abs(hi - max) < span * CLEAR_EPSILON;
  if (isFullRange) {
    onClear();
  } else {
    onChange(lo, hi);
  }
  return [lo, hi];
}

interface RangeEndpointInputProps {
  value: number;
  format: (v: number) => string;
  ariaLabel: string;
  align?: "left" | "right";
  onCommit: (next: number) => void;
}

/**
 * Click-to-edit range endpoint. Shows the formatted value (e.g. "1.5s", "$0.05") in the
 * steady state; on focus it switches to the raw number so users can type a precise
 * filter bound — much faster than dragging the slider to a specific cost or duration.
 */
export const RangeEndpointInput: React.FC<RangeEndpointInputProps> = ({
  value,
  format,
  ariaLabel,
  align = "left",
  onCommit,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const display = useMemo(() => format(value), [format, value]);

  const commit = useCallback(() => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === "") return;
    const parsed = parseEditedValue(trimmed);
    if (parsed === null || parsed === value) return;
    onCommit(parsed);
  }, [draft, onCommit, value]);

  return (
    <Input
      size="xs"
      variant="flushed"
      width="50%"
      paddingX={1}
      paddingY={0}
      height="20px"
      minHeight="20px"
      textAlign={align}
      textStyle="2xs"
      color="fg.subtle"
      border="none"
      bg="transparent"
      _focus={{
        bg: "bg.muted/50",
        color: "fg",
        outline: "none",
        boxShadow: "none",
      }}
      _hover={{ bg: "bg.muted/30" }}
      cursor={editing ? "text" : "pointer"}
      aria-label={ariaLabel}
      value={editing ? draft : display}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        // Seed the draft with the raw number (no units / currency) so
        // typing replaces the value cleanly without the user fighting
        // the formatter.
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
};
