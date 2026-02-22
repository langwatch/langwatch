import { Text, VStack } from "@chakra-ui/react";

export function PricingSummary({
  totalPrice,
  seatCount,
  perSeatPrice,
  totalTestId,
}: {
  totalPrice: string;
  seatCount: number;
  perSeatPrice?: string | null;
  totalTestId?: string;
}) {
  return (
    <VStack align="start" gap={0}>
      <Text data-testid={totalTestId} fontSize="sm" color="gray.700">
        {totalPrice} for {seatCount} seat{seatCount !== 1 ? "s" : ""}
      </Text>
      {perSeatPrice && seatCount >1 && (
        <Text fontSize="sm" color="gray.500">
          {perSeatPrice}
        </Text>
      )}
    </VStack>
  );
}
