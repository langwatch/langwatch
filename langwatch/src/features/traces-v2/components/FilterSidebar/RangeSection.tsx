import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import { useFacetLensStore } from "../../stores/facetLensStore";
import { SidebarSection } from "./SidebarSection";

const COMMIT_DEBOUNCE_MS = 150;
/** Snap to "cleared" when both endpoints are within this fraction of the full range. */
const CLEAR_EPSILON = 0.01;

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
}

export const RangeSection: React.FC<RangeSectionProps> = ({
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

  const handleChangeEnd = useCallback(
    (details: { value: number[] }) => {
      const [from, to] = details.value;
      if (from === undefined || to === undefined) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const isFullRange =
          Math.abs(from - min) < span * CLEAR_EPSILON &&
          Math.abs(to - max) < span * CLEAR_EPSILON;
        if (isFullRange) {
          onClear();
        } else {
          onChange(from, to);
        }
      }, COMMIT_DEBOUNCE_MS);
    },
    [min, max, span, onChange, onClear],
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
      hasActive={isActive}
      activeIndicator={
        summary ? (
          <Text
            textStyle="2xs"
            color="blue.fg"
            fontFamily="mono"
            fontWeight="500"
          >
            {summary}
          </Text>
        ) : undefined
      }
    >
      <VStack gap={2} align="stretch" paddingX={2}>
        {/*
         * A SimpleSlider with `min === max` (or any non-positive span)
         * trips zag-js's invariants and throws synchronously, which has
         * been masking real errors during empty-state mounts. Skip the
         * slider in that degenerate case and render the single value
         * as static text instead.
         */}
        {max > min ? (
          <>
            <SimpleSlider
              size="sm"
              min={min}
              max={max}
              value={localValue}
              onValueChange={(d) => setLocalValue([d.value[0]!, d.value[1]!])}
              onValueChangeEnd={handleChangeEnd}
              colorPalette={isActive ? "blue" : "gray"}
            />

            <HStack justify="space-between">
              <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                {formatValue(localValue[0])}
              </Text>
              <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
                {formatValue(localValue[1])}
              </Text>
            </HStack>
          </>
        ) : (
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            {formatValue(min)}
          </Text>
        )}
      </VStack>
    </SidebarSection>
  );
};
