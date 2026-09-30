/**
 * Upgrade Plan Block - displays upgrade CTA with features and dynamic pricing
 */
import { Button, Card, Flex, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
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
    <Card.Root data-testid="upgrade-plan-block">
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="center">
            <VStack align="start" gap={1}>
              <Text fontWeight="semibold" fontSize="lg">
                Upgrade to {planName}
              </Text>

              <PricingSummary
                totalPrice={totalPrice}
                seatCount={coreMembers}
                perSeatPrice={monthlyEquivalent}
                totalTestId="upgrade-total"
              />
            </VStack>
            <Button
              variant="outline"
              colorPalette="orange"
              size="sm"
              onClick={onUpgrade}
              loading={isLoading}
              disabled={isLoading}
            >
              Upgrade now
            </Button>
          </Flex>

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
      </Card.Body>
    </Card.Root>
  );
}
