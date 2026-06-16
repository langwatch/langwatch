import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import { Tooltip } from "~/components/ui/tooltip";
import { useFacetLensStore } from "../../stores/facetLensStore";
import {
  commitRange as commitRangeShared,
  RangeEndpointInput,
  stepForSpan,
} from "./rangeControls";
import { SidebarSection } from "./SidebarSection";

const COMMIT_DEBOUNCE_MS = 150;
/**
 * Clamp both thumb values into the facet's current bounds. The slider value
 * lives in local state while min/max stream in from the facet snapshot, so
 * for a frame the two can disagree (stale committed filter, snapshot
 * refresh moving the bounds). zag-js throws synchronously when a thumb sits
 * fully outside [min, max], which used to take the whole filter section
 * down with a "Couldn't render the cost filter" error card until a retry.
 * Exported for unit testing.
 */
export function clampRangeToBounds(
  value: [number, number],
  min: number,
  max: number,
): [number, number] {
  const clamp = (v: number) =>
    Math.min(Math.max(Number.isFinite(v) ? v : min, min), max);
  return [clamp(value[0]), clamp(value[1])];
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

  // Drop-NaN / clamp / sort / full-range-clears semantics live in the
  // shared helper so the drilldown's score slider behaves identically.
  const commitRange = useCallback(
    (rawFrom: number, rawTo: number) =>
      commitRangeShared({ rawFrom, rawTo, min, max, span, onChange, onClear }),
    [min, max, span, onChange, onClear],
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
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const normalized = commitRange(rawFrom, rawTo);
      if (normalized) setLocalValue(normalized);
    },
    [commitRange],
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
          <Text textStyle="2xs" color="blue.fg" fontWeight="500">
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
                  step={stepForSpan(max - min)}
                  value={clampRangeToBounds(localValue, min, max)}
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
