import { Banner } from "@langwatch/design-system/banner";
import { HStack, Separator, Text, VStack } from "@langwatch/design-system/primitives";

import type { SeatChangeSummary } from "../../model/seat-change-summary.ts";

/** What a seat count change costs and when, above the button that makes it. */
export function SeatChangeSummaryBlock({ summary }: { summary: SeatChangeSummary }) {
  return (
    <VStack align="stretch" gap={3} width="full" data-testid="seat-change-summary">
      {summary.note && (
        <Banner status="info" data-testid="seat-change-note">
          {summary.note}
        </Banner>
      )}
      <VStack align="stretch" gap={2} fontSize="sm" padding={4} bg="bg.subtle" borderRadius="md">
        {summary.rows.map((row, index) => (
          <VStack key={row.label} align="stretch" gap={2}>
            {index > 0 && <Separator />}
            <HStack justify="space-between" color={row.muted ? "fg.muted" : undefined}>
              <Text>{row.label}</Text>
              <Text
                fontWeight={row.muted ? "normal" : "semibold"}
                fontVariantNumeric="tabular-nums"
              >
                {row.value}
              </Text>
            </HStack>
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}
