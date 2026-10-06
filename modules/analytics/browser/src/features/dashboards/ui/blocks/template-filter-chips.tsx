/**
 * One row of multi-select filter chips with an "All" chip that clears the row. The design
 * system's `FilterChips` picks one value, and the templates library needs several.
 */

import { Button, HStack, Text } from "@langwatch/design-system/primitives";

/** One chip: the value it picks, its words, how many templates it shows, and its palette. */
export interface TemplateFilterChip<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly count: number;
  readonly colorPalette?: string;
}

function Chip({
  label,
  count,
  isActive,
  colorPalette = "gray",
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  colorPalette?: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      variant={isActive ? "subtle" : "ghost"}
      colorPalette={isActive ? colorPalette : "gray"}
      borderRadius="full"
      borderWidth="1px"
      borderColor={isActive ? "colorPalette.emphasized" : "border"}
      color={isActive ? "colorPalette.fg" : "fg.muted"}
      fontWeight={isActive ? "semibold" : "normal"}
      paddingX={3}
      aria-pressed={isActive}
      onClick={onClick}
    >
      <HStack gap={1.5}>
        <Text>{label}</Text>
        <Text fontVariantNumeric="tabular-nums" color={isActive ? "colorPalette.fg" : "fg.subtle"}>
          {count}
        </Text>
      </HStack>
    </Button>
  );
}

export function TemplateFilterChips<Value extends string>({
  groupLabel,
  allCount,
  chips,
  picked,
  onChange,
}: {
  /** Names the row for assistive technology, e.g. "Filter by agent kind". */
  groupLabel: string;
  allCount: number;
  chips: readonly TemplateFilterChip<Value>[];
  picked: readonly Value[];
  onChange: (next: Value[]) => void;
}) {
  const toggle = (value: Value) =>
    onChange(picked.includes(value) ? picked.filter((each) => each !== value) : [...picked, value]);
  return (
    <HStack
      as="fieldset"
      aria-label={groupLabel}
      gap={1}
      wrap="wrap"
      border="none"
      margin={0}
      padding={0}
    >
      <Chip
        label="All"
        count={allCount}
        isActive={picked.length === 0}
        onClick={() => onChange([])}
      />
      {chips.map((chip) => (
        <Chip
          key={chip.value}
          label={chip.label}
          count={chip.count}
          isActive={picked.includes(chip.value)}
          colorPalette={chip.colorPalette}
          onClick={() => toggle(chip.value)}
        />
      ))}
    </HStack>
  );
}
