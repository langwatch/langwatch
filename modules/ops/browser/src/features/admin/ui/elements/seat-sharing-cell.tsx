import { Badge, HStack, Text } from "@langwatch/design-system/primitives";

import { peopleOnSeats, sharingRatio, type SeatSharingReading } from "../../model/seat-sharing.ts";

/**
 * One organization's seat use from the last check; a free organization is not checked.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
export function SeatSharingCell({ reading }: { reading: SeatSharingReading | undefined }) {
  if (!reading) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Not checked
      </Text>
    );
  }
  return (
    <HStack gap={2} wrap="nowrap">
      <Text fontSize="sm" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">
        {peopleOnSeats(reading)}
      </Text>
      {reading.flagged && (
        <Badge
          colorPalette="orange"
          whiteSpace="nowrap"
          title="Distinct active people in the last 30 days went over 2x seats"
        >
          Seat sharing {sharingRatio(reading)}
        </Badge>
      )}
    </HStack>
  );
}
