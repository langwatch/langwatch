/**
 * Update seats Block - allows Growth plan users to finalize seat changes
 */
import {
  Button,
  Card,
  Flex,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { PricingSummary } from "./PricingSummary";

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
    <Card.Root
      data-testid="update-seats-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
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
              variant="ghost"
              size="md"
              onClick={onDiscard}
              disabled={isLoading}
            >
              Discard
            </Button>
            <Button
              colorPalette="blue"
              size="md"
              onClick={onUpdate}
              loading={isLoading}
              disabled={isLoading}
            >
              Update subscription
            </Button>
          </HStack>
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}
