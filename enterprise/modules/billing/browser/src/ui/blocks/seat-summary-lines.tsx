import { HStack, Separator, Text, VStack } from "@langwatch/design-system/primitives";

import type { SeatSummaryLine } from "../../model/seat-purchase.ts";

/** The drawer footer's bill: the breakdown, then the total under a rule. */
export function SeatSummaryLines({ lines }: { lines: SeatSummaryLine[] }) {
  return (
    <VStack
      align="stretch"
      gap={2}
      fontSize="sm"
      padding={4}
      bg="bg.subtle"
      borderRadius="md"
      width="full"
      data-testid="seat-change-summary"
    >
      {lines.map((line) => (
        <VStack key={line.label} align="stretch" gap={2}>
          {line.ruled && <Separator />}
          <HStack justify="space-between" align="start" color={line.muted ? "fg.muted" : undefined}>
            <Text fontWeight={line.emphasis ? "semibold" : undefined}>{line.label}</Text>
            <VStack align="end" gap={0}>
              <Text
                fontWeight={line.muted ? "normal" : "semibold"}
                color={line.emphasis ? "blue.fg" : undefined}
                fontVariantNumeric="tabular-nums"
              >
                {line.value}
              </Text>
              {line.note && (
                <Text fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
                  {line.note}
                </Text>
              )}
            </VStack>
          </HStack>
        </VStack>
      ))}
    </VStack>
  );
}
