import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import { useFacetLensStore } from "../../stores/facetLensStore";
import { SidebarSection } from "./SidebarSection";

interface RangeSectionProps {
  title: string;
  field: string;
  min: number;
  max: number;
  currentFrom?: number;
  currentTo?: number;
  formatValue: (v: number) => string;
  onChange: (from: string, to: string) => void;
  onClear: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export const RangeSection: React.FC<RangeSectionProps> = ({
  title,
  field,
  min,
  max,
  currentFrom,
  currentTo,
  formatValue,
  onChange,
  onClear,
  dragHandleProps,
}) => {
  const lensOverride = useFacetLensStore((s) => s.lens.sectionOpen[field]);
  const setSectionOpen = useFacetLensStore((s) => s.setSectionOpen);
  const [localValue, setLocalValue] = useState<number[]>([
    currentFrom ?? min,
    currentTo ?? max,
  ]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive = currentFrom !== undefined || currentTo !== undefined;

  useEffect(() => {
    setLocalValue([currentFrom ?? min, currentTo ?? max]);
  }, [currentFrom, currentTo, min, max]);

  const range = max - min || 1;

  const handleChangeEnd = useCallback(
    (details: { value: number[] }) => {
      const [from, to] = details.value;
      if (from === undefined || to === undefined) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (
          Math.abs(from - min) < range * 0.01 &&
          Math.abs(to - max) < range * 0.01
        ) {
          onClear();
        } else {
          onChange(String(from), String(to));
        }
      }, 150);
    },
    [min, max, range, onChange, onClear],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const summary = isActive
    ? `${formatValue(currentFrom ?? min)} – ${formatValue(currentTo ?? max)}`
    : undefined;

  const effectiveOpen = lensOverride ?? isActive;

  return (
    <SidebarSection
      title={title}
      open={effectiveOpen}
      onOpenChange={(next) => setSectionOpen(field, next)}
      dragHandleProps={dragHandleProps}
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
        <SimpleSlider
          size="sm"
          min={min}
          max={max}
          value={localValue}
          onValueChange={(d) => setLocalValue(d.value)}
          onValueChangeEnd={handleChangeEnd}
          colorPalette={isActive ? "blue" : "gray"}
        />

        <HStack justify="space-between">
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            {formatValue(localValue[0]!)}
          </Text>
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            {formatValue(localValue[1]!)}
          </Text>
        </HStack>
      </VStack>
    </SidebarSection>
  );
};

