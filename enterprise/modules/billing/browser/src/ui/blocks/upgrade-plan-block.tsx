import { AccessState } from "@langwatch/design-system/access-state";
/**
 * Upgrade Plan Block - displays upgrade CTA with features and dynamic pricing
 */
import { Button, HStack, SimpleGrid, Text, VStack } from "@langwatch/design-system/primitives";
import { Check } from "lucide-react";
import type React from "react";

import { PricingSummary } from "../elements/pricing-summary.tsx";

export function UpgradePlanBlock({
  planName,
  totalPrice,
  coreMembers,
  features,
  monthlyEquivalent,
  onUpgrade,
  isLoading,
}: {
  planName: React.ReactNode;
  totalPrice: string;
  coreMembers: number;
  features: string[];
  monthlyEquivalent?: string | null;
  onUpgrade?: () => void;
  isLoading?: boolean;
}) {
  return (
    <AccessState
      kind="upgrade"
      title={<>Upgrade to {planName}</>}
      description="Your current plan doesn't cover these seats. Review the price below, then continue to checkout."
      data-testid="upgrade-plan-block"
      actions={
        <Button
          colorPalette="orange"
          size="sm"
          onClick={onUpgrade}
          loading={isLoading}
          disabled={isLoading}
        >
          Upgrade now
        </Button>
      }
    >
      <VStack align="stretch" gap={5}>
        <PricingSummary
          totalPrice={totalPrice}
          seatCount={coreMembers}
          perSeatPrice={monthlyEquivalent}
          totalTestId="upgrade-total"
        />
        <SimpleGrid
          data-testid="upgrade-plan-features-grid"
          templateColumns={{ base: "1fr", md: "1fr 1.4fr 1fr" }}
          gap={2}
          color="fg.muted"
        >
          {features.map((feature, index) => (
            <HStack key={index} gap={2}>
              <Check size={16} />
              <Text fontSize="sm">{feature}</Text>
            </HStack>
          ))}
        </SimpleGrid>
      </VStack>
    </AccessState>
  );
}
