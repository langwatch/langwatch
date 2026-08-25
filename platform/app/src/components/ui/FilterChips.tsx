import { Button, HStack, Text } from "@chakra-ui/react";

/** One chip: the cut it selects, what it is called, and how many rows it holds. */
export interface FilterChipItem {
  value: string;
  label: string;
  count: number;
}

/**
 * A row of pill-shaped filter chips above a table, each carrying the number of
 * rows it would leave on screen.
 *
 * The count is the point. A filter that hides its own consequences makes people
 * click every option to find out where the rows are; a count next to the label
 * answers that before the click, and a cut with nothing behind it is simply not
 * offered (the caller decides that by leaving the chip out).
 *
 * Two restraints keep a chip row from turning into decoration. The count is set
 * in the chip's own type at tabular figures rather than nested in a second
 * badge, so a chip stays one object instead of a chip inside a chip. And only
 * the selected chip carries colour: an unselected row is quiet enough that the
 * selection is legible at a glance rather than competing with four siblings.
 *
 * Presentational and controlled — it owns no state.
 */
export function FilterChips({
  value,
  onChange,
  items,
  groupLabel,
  countNoun,
  colorPalette = "blue",
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  items: FilterChipItem[];
  /** Names the whole row for assistive technology, e.g. "Filter keys by scope". */
  groupLabel: string;
  /** What the counts count, so a chip reads "Team, 1 key" rather than "Team1". */
  countNoun: { singular: string; plural: string };
  colorPalette?: string;
  testId?: string;
}) {
  return (
    <HStack
      gap={1}
      wrap="wrap"
      role="group"
      aria-label={groupLabel}
      data-testid={testId}
    >
      {items.map((item) => (
        <FilterChip
          key={item.value}
          item={item}
          isActive={item.value === value}
          countNoun={countNoun}
          colorPalette={colorPalette}
          testId={testId ? `${testId}-${item.value}` : undefined}
          onSelect={() => onChange(item.value)}
        />
      ))}
    </HStack>
  );
}

function FilterChip({
  item,
  isActive,
  countNoun,
  colorPalette,
  testId,
  onSelect,
}: {
  item: FilterChipItem;
  isActive: boolean;
  countNoun: { singular: string; plural: string };
  colorPalette: string;
  testId?: string;
  onSelect: () => void;
}) {
  const noun = item.count === 1 ? countNoun.singular : countNoun.plural;

  return (
    <Button
      size="xs"
      variant={isActive ? "subtle" : "ghost"}
      colorPalette={isActive ? colorPalette : "gray"}
      borderRadius="full"
      borderWidth="1px"
      borderColor={isActive ? "colorPalette.emphasized" : "transparent"}
      color={isActive ? "colorPalette.fg" : "fg.muted"}
      fontWeight={isActive ? "semibold" : "normal"}
      paddingX={3}
      aria-pressed={isActive}
      aria-label={`${item.label}, ${item.count} ${noun}`}
      data-testid={testId}
      onClick={onSelect}
    >
      <HStack gap={1.5}>
        <Text>{item.label}</Text>
        <Text
          fontVariantNumeric="tabular-nums"
          color={isActive ? "colorPalette.fg" : "fg.subtle"}
          aria-hidden
        >
          {item.count}
        </Text>
      </HStack>
    </Button>
  );
}
