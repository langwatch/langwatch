import { Text, VStack } from "@langwatch/design-system/primitives";

import { EXCLUDING_VAT } from "../../model/billing-plans.ts";

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
      <Text data-testid={totalTestId} fontSize="sm" color="fg">
        {totalPrice} for {seatCount} seat{seatCount !== 1 ? "s" : ""}{" "}
        <Text as="span" fontSize="xs" color="fg.muted">
          {EXCLUDING_VAT}
        </Text>
      </Text>
      {perSeatPrice && seatCount > 1 && (
        <Text fontSize="xs" color="fg.muted">
          {perSeatPrice}
        </Text>
      )}
    </VStack>
  );
}
