/**
 * Upgrade Plan Block - displays upgrade CTA with features and dynamic pricing
 */
import {
  Button,
  Card,
  Flex,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check } from "lucide-react";
import React from "react";

export function UpgradePlanBlock({
  planName,
  pricePerSeat,
  totalPrice,
  coreMembers,
  features,
  monthlyEquivalent,
  onUpgrade,
  isLoading,
}: {
  planName: React.ReactNode;
  pricePerSeat: React.ReactNode;
  totalPrice: string;
  coreMembers: number;
  features: string[];
  monthlyEquivalent?: string | null;
  onUpgrade?: () => void;
  isLoading?: boolean;
}) {
  return (
    <Card.Root
      data-testid="upgrade-plan-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="center">
            <VStack align="start" gap={1}>
              <Text fontWeight="semibold" fontSize="lg">
                Upgrade to {planName}
              </Text>

              <Text
                data-testid="upgrade-total"
                fontSize="sm"
                paddingY={4}
                fontWeight="medium"
                color="gray.700"
              >
                {totalPrice} per {coreMembers} Full Member
                {coreMembers !== 1 ? "s" : ""}
              </Text>
              {monthlyEquivalent && (
                <Text fontSize="xs" color="gray.500">
                  ({monthlyEquivalent})
                </Text>
              )}
            </VStack>
            <Button
              colorPalette="blue"
              size="md"
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
          >
            {features.map((feature, index) => (
              <HStack key={index} gap={2}>
                <Check size={16} color="var(--chakra-colors-blue-500)" />
                <Text fontSize="sm" color="gray.600">
                  {feature}
                </Text>
              </HStack>
            ))}
          </SimpleGrid>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
