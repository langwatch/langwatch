/**
 * Update seats Block - allows Growth plan users to finalize seat changes
 */
import { Card } from "@langwatch/design-system/card";
import { Button, Flex, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { PricingSummary } from "../elements/pricing-summary.tsx";

export function UpdateSeatsBlock({
  totalFullMembers,
  totalPrice,
  monthlyEquivalent,
  onUpdate,
  onDiscard,
  isLoading,
}: {
  totalFullMembers: number;
  totalPrice: string;
  monthlyEquivalent?: string | null;
  onUpdate: () => void;
  onDiscard: () => void;
  isLoading?: boolean;
}) {
  return (
    <Card data-testid="update-seats-block" padding="inline-lg">
      <Flex justifyContent="space-between" alignItems="center">
        <VStack align="start" gap={1}>
          <Text fontWeight="semibold" fontSize="lg">
            Update seats
          </Text>
          <PricingSummary
            totalPrice={totalPrice}
            seatCount={totalFullMembers}
            perSeatPrice={monthlyEquivalent}
          />
        </VStack>
        <HStack gap={2}>
          <Button
            data-testid="discard-seat-changes-button"
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={isLoading}
          >
            Discard
          </Button>
          <Button
            variant="outline"
            colorPalette="orange"
            size="sm"
            onClick={onUpdate}
            loading={isLoading}
            disabled={isLoading}
          >
            Update subscription
          </Button>
        </HStack>
      </Flex>
    </Card>
  );
}
