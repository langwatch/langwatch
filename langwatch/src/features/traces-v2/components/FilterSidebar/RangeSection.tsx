import { Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import { Tooltip } from "~/components/ui/tooltip";
import { useFacetLensStore } from "../../stores/facetLensStore";
import { SidebarSection } from "./SidebarSection";

const COMMIT_DEBOUNCE_MS = 150;
/** Snap to "cleared" when both endpoints are within this fraction of the full range. */
const CLEAR_EPSILON = 0.01;

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

interface RangeSectionProps {
  title: string;
  icon?: React.ElementType;
  field: string;
  min: number;
  max: number;
  currentFrom?: number;
  currentTo?: number;
  formatValue: (v: number) => string;
  onChange: (from: number, to: number) => void;
  onClear: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  onShiftToggle?: (nextOpen: boolean) => void;
  /** Remove this section from the sidebar (per-user). */
  onHide?: () => void;
  orGroupId?: string;
  orPeers?: readonly string[];
  /**
   * True when this range section was synthesised as a placeholder before
   * traces arrive. When `min === max === 0`, renders a caption instead of
   * an unusable zero-span slider.
   */
  synthetic?: boolean;
}

const RangeSectionInner: React.FC<RangeSectionProps> = ({
  title,
  icon,
  field,
  min,
  max,
  currentFrom,
  currentTo,
  formatValue,
  onChange,
  onClear,
  dragHandleProps,
  onShiftToggle,
  onHide,
  orGroupId,
  orPeers,
  synthetic,
}) => {
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [localValue, setLocalValue] = useState<[number, number]>([
    currentFrom ?? min,
    currentTo ?? max,
  ]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = currentFrom !== undefined || currentTo !== undefined;
  const span = max - min || 1;

  useEffect(() => {
    setLocalValue([currentFrom ?? min, currentTo ?? max]);
  }, [currentFrom, currentTo, min, max]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Clamp to [min, max] and sort low/high so callers can't briefly emit
  // an inverted or out-of-range tuple. Pulled out so both the
  // commit/debounce path and the typed-edit path go through the same
  // normalisation step.
  const normalizeRange = useCallback(
    (rawFrom: number, rawTo: number): [number, number] => [
      Math.max(min, Math.min(rawFrom, rawTo)),
      Math.min(max, Math.max(rawFrom, rawTo)),
    ],
    [min, max],
  );

  const commitRange = useCallback(
    (rawFrom: number, rawTo: number) => {
      // Drop NaN / Infinity straight away so we never emit `[NaN TO NaN]`
      // into the URL — zag-js can hand us undefined on degenerate slider
      // states, and our previous `value[0]!` non-null assertion turned
      // those into NaN that propagated through the query string.
      if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return;
      // Honour the [min, max] bounds even if the input came from a typed
      // value that overshot the slider range — a 5h duration filter on a
      // project where the slowest trace is 30s should clamp to the
      // observed max rather than fail server-side.
      const [lo, hi] = normalizeRange(rawFrom, rawTo);
      const isFullRange =
        Math.abs(lo - min) < span * CLEAR_EPSILON &&
        Math.abs(hi - max) < span * CLEAR_EPSILON;
      if (isFullRange) {
        onClear();
      } else {
        onChange(lo, hi);
      }
    },
    [min, max, span, onChange, onClear, normalizeRange],
  );

  const handleChangeEnd = useCallback(
    (details: { value: number[] }) => {
      const [from, to] = details.value;
      if (from === undefined || to === undefined) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        commitRange(from, to);
      }, COMMIT_DEBOUNCE_MS);
    },
    [commitRange],
  );

  // Typed-edit commits cancel any pending slider debounce + normalise
  // before writing localValue. Without this, a stale drag commit could
  // overwrite the typed value moments later, and the slider could
  // briefly receive an inverted/out-of-range tuple while parent state
  // syncs back. Both paths now route through the same shape.
  const commitImmediate = useCallback(
    (rawFrom: number, rawTo: number) => {
      if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const [lo, hi] = normalizeRange(rawFrom, rawTo);
      setLocalValue([lo, hi]);
      commitRange(lo, hi);
    },
    [commitRange, normalizeRange],
  );

  const summary = isActive
    ? `${formatValue(currentFrom ?? min)} – ${formatValue(currentTo ?? max)}`
    : undefined;

  const effectiveOpen = lensOverride ?? isActive;

  return (
    <SidebarSection
      title={title}
      icon={icon}
      open={effectiveOpen}
      onOpenChange={(next) => setSectionOpen(field, next)}
      dragHandleProps={dragHandleProps}
      onShiftToggle={onShiftToggle}
      onHide={onHide}
      hideLabel={`Hide ${title}`}
      orGroupId={orGroupId}
      orPeers={orPeers}
      hasActive={isActive}
      activeIndicator={
        summary ? (
          <Text
            textStyle="2xs"
            color="blue.fg"
            fontWeight="500"
          >
            {summary}
          </Text>
        ) : undefined
      }
    >
      <VStack gap={2} align="stretch" paddingX={2}>
        {/* Synthetic placeholder — shown when the range section exists but no
            traces have been ingested yet (min === max === 0, synthetic flag). */}
        {synthetic && min === 0 && max === 0 ? (
          <Box
            paddingX={1}
            paddingY={1.5}
            borderRadius="sm"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border.subtle"
          >
            <Text textStyle="2xs" color="fg.subtle" lineHeight="1.3">
              Range will populate once traces arrive
            </Text>
          </Box>
        ) : null}
        {!synthetic || max > 0 ? (
        <>
        {/*
         * A SimpleSlider with `min === max` (or any non-positive span)
         * trips zag-js's invariants and throws synchronously, which has
         * been masking real errors during empty-state mounts. Skip the
         * slider in that degenerate case.
         *
         * When every visible trace shares the same value (e.g. all
         * traces have `totalTokens = 512`) the range can't narrow
         * anything. Render a disabled-looking slider with both thumbs
         * collapsed at the value plus a hover tooltip explaining why
         * — visually consistent with the interactive case, just
         * inert. Rare in practice (mostly sample-data territory) so
         * it doesn't deserve its own special-case empty-state copy.
         */}
        {max > min ? (
          <>
            <SimpleSlider
              size="sm"
              min={min}
              max={max}
              value={localValue}
              onValueChange={(d) => {
                // Drop frames that would inject NaN into local state —
                // zag-js can momentarily emit `undefined` on degenerate
                // ranges (rapid resize, value === min === max). Falling
                // back to the previous local value keeps the slider
                // visually stable instead of glitching to "0".
                const lo = d.value[0];
                const hi = d.value[1];
                if (lo === undefined || hi === undefined) return;
                setLocalValue([lo, hi]);
              }}
              onValueChangeEnd={handleChangeEnd}
              colorPalette={isActive ? "blue" : "gray"}
            />

            <HStack justify="space-between" gap={2}>
              <RangeEndpointInput
                value={localValue[0]}
                format={formatValue}
                ariaLabel={`${title} minimum`}
                onCommit={(n) => commitImmediate(n, localValue[1])}
              />
              <RangeEndpointInput
                value={localValue[1]}
                format={formatValue}
                ariaLabel={`${title} maximum`}
                align="right"
                onCommit={(n) => commitImmediate(localValue[0], n)}
              />
            </HStack>
          </>
        ) : (
          <DisabledRangeVisual
            value={min}
            format={formatValue}
            isActive={isActive}
            onClear={onClear}
          />
        )}
        </>
        ) : null}
      </VStack>
    </SidebarSection>
  );
};

export const RangeSection = memo(RangeSectionInner);

interface RangeEndpointInputProps {
  value: number;
  format: (v: number) => string;
  ariaLabel: string;
  align?: "left" | "right";
  onCommit: (next: number) => void;
}

/**
 * Click-to-edit range endpoint. Shows the formatted value (e.g. "1.5s",
 * "$0.05") in the steady state; on focus it switches to the raw number
 * so users can type a precise filter bound — much faster than dragging
 * the slider to a specific cost or duration. Commits on Enter or blur,
 * silently rejects unparseable input (the field reverts to the current
 * value via the next prop sync).
 */
/**
 * Disabled visual for the `min === max` case. Mimics the SimpleSlider's
 * track + filled segment + thumbs at the same position, drained of
 * colour, with a hover tooltip explaining why interaction is blocked.
 * We can't actually mount a SimpleSlider here — zag-js asserts on
 * `min !== max` and throws synchronously — so this is a CSS-only
 * stand-in that matches the live slider's visual rhythm so the section
 * doesn't read as broken.
 *
 * Rare in practice: typically only fires on sample data or projects
 * that have run a single trace. Keeping the Clear escape hatch in case
 * a URL-driven filter somehow lands here.
 */
const DisabledRangeVisual: React.FC<{
  value: number;
  format: (v: number) => string;
  isActive: boolean;
  onClear: () => void;
}> = ({ value, format, isActive, onClear }) => (
  <VStack align="stretch" gap={1.5}>
    <Tooltip content="Can't change the range — every trace shares this value.">
      <Box
        position="relative"
        height="20px"
        cursor="not-allowed"
        aria-disabled="true"
        opacity={0.6}
      >
        {/* Track */}
        <Box
          position="absolute"
          left={0}
          right={0}
          top="50%"
          transform="translateY(-50%)"
          height="4px"
          borderRadius="full"
          bg="border"
        />
        {/* Filled segment — collapsed at the value, so just the thumb pair */}
        <Box
          position="absolute"
          left="50%"
          top="50%"
          transform="translate(-50%, -50%)"
          width="14px"
          height="14px"
          borderRadius="full"
          bg="bg.surface"
          borderWidth="2px"
          borderColor="fg.muted"
        />
      </Box>
    </Tooltip>
    <HStack justify="space-between" align="center" gap={2}>
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
        {format(value)}
      </Text>
      {isActive && (
        <Button
          size="2xs"
          variant="ghost"
          color="blue.fg"
          paddingX={1}
          height="auto"
          minHeight={0}
          onClick={onClear}
          aria-label="Clear range filter"
        >
          Clear
        </Button>
      )}
    </HStack>
  </VStack>
);

const RangeEndpointInput: React.FC<RangeEndpointInputProps> = ({
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
