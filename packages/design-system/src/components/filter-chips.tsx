import { Button, HStack, Text } from "../primitives.ts";

/** One chip: the cut it selects, what it is called, and optionally how many rows it holds. */
export interface FilterChipItem {
  value: string;
  label: string;
  count?: number;
}

type CountNoun = { singular: string; plural: string };

/**
 * Pill-shaped filter chips above a list or chart, optionally each carrying the
 * number of rows it would leave on screen. Controlled; only the selected chip
 * carries colour.
 */
export function FilterChips({
  value,
  onChange,
  items,
  groupLabel,
  countNoun,
  colorPalette = "orange",
  testId,
}: {
  value: string;
  onChange: (next: string) => void;
  items: readonly FilterChipItem[];
  /** Names the whole row for assistive technology, e.g. "Filter keys by scope". */
  groupLabel: string;
  /** What the counts count, so a chip reads "Team, 1 key" rather than "Team1". */
  countNoun?: CountNoun;
  colorPalette?: string;
  testId?: string;
}) {
  return (
    <HStack
      as="fieldset"
      border="none"
      margin={0}
      padding={0}
      minWidth={0}
      gap={1}
      wrap="wrap"
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

function countLabel({ item, countNoun }: { item: FilterChipItem; countNoun?: CountNoun }) {
  if (item.count === undefined || !countNoun) return undefined;
  const noun = item.count === 1 ? countNoun.singular : countNoun.plural;
  return `${item.label}, ${item.count} ${noun}`;
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
  countNoun?: CountNoun;
  colorPalette: string;
  testId?: string;
  onSelect: () => void;
}) {
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
      aria-label={countLabel({ item, countNoun })}
      data-testid={testId}
      onClick={onSelect}
    >
      {item.count === undefined ? (
        item.label
      ) : (
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
      )}
    </Button>
  );
}
