import { HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { compactNumber, describeNumber } from "../../display-formatters.ts";
import { Tooltip } from "../overlays/tooltip.tsx";

export function NumberFormats({
  value,
  currency,
  unit,
}: {
  value: number;
  currency?: string;
  unit?: string;
}) {
  const formats = describeNumber({ value, currency });
  const rows: [string, string][] = [
    ["Compact", formats.compact],
    ["Full", formats.integer],
    ["Exact", formats.precise],
  ];
  return (
    <VStack align="stretch" gap={0.5} data-testid="number-formats">
      {rows.map(([label, text]) => (
        <HStack key={label} justify="space-between" gap={4}>
          <Text textStyle="2xs">{label}</Text>
          <Text textStyle="xs" fontVariantNumeric="tabular-nums">
            {text}
            {unit ? ` ${unit}` : ""}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** A number scaled to the right unit, with every other format on hover. */
export function FormattedNumber({
  value,
  currency,
  unit,
  children,
}: {
  value: number;
  currency?: string;
  unit?: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip content={<NumberFormats value={value} currency={currency} unit={unit} />}>
      <Text as="span" whiteSpace="nowrap" cursor="help" fontVariantNumeric="tabular-nums">
        {children ?? compactNumber({ value, currency })}
      </Text>
    </Tooltip>
  );
}
