import { Group, IconButton, Text } from "@langwatch/design-system/primitives";
import { Minus, Plus } from "lucide-react";

/** A whole-number count with minus and plus, the minus off at the floor. */
export function SeatStepper({
  value,
  minimum,
  onChange,
  label,
  testId,
}: {
  value: number;
  minimum: number;
  onChange: (value: number) => void;
  /** Names the count for assistive technology: "Full seats", "Developer seats". */
  label: string;
  testId: string;
}) {
  return (
    <Group attached data-testid={testId}>
      <IconButton
        aria-label={`Fewer ${label.toLowerCase()}`}
        size="sm"
        variant="outline"
        disabled={value <= minimum}
        onClick={() => onChange(Math.max(minimum, value - 1))}
        data-testid={`${testId}-minus`}
      >
        <Minus size={14} />
      </IconButton>
      <Text
        as="output"
        aria-label={label}
        aria-live="polite"
        minWidth="44px"
        textAlign="center"
        textStyle="bodySm"
        fontWeight={600}
        fontVariantNumeric="tabular-nums"
        borderTopWidth="1px"
        borderBottomWidth="1px"
        borderColor="border"
        paddingY={1.5}
        data-testid={`${testId}-value`}
      >
        {value}
      </Text>
      <IconButton
        aria-label={`More ${label.toLowerCase()}`}
        size="sm"
        variant="outline"
        onClick={() => onChange(value + 1)}
        data-testid={`${testId}-plus`}
      >
        <Plus size={14} />
      </IconButton>
    </Group>
  );
}
