/**
 * Trial Upgrade Block - displays trial countdown and upgrade CTA
 *
 * Shown on the subscription page when the user has an active trial.
 * Prompts the user to upgrade to a paid Growth plan before the trial expires.
 */
import {
  Badge,
  Button,
  Card,
  Flex,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Clock } from "lucide-react";

export function TrialUpgradeBlock({
  daysRemaining,
  totalPrice,
  coreMembers,
  features,
  monthlyEquivalent,
  onUpgrade,
  isLoading,
}: {
  daysRemaining: number;
  totalPrice: string;
  coreMembers: number;
  features: string[];
  monthlyEquivalent?: string | null;
  onUpgrade?: () => void;
  isLoading?: boolean;
}) {
  return (
    <Card.Root
      data-testid="trial-upgrade-block"
      borderWidth={1}
      borderColor="orange.200"
      bg="orange.50"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="center">
            <VStack align="start" gap={1}>
              <HStack gap={2}>
                <Clock size={16} color="var(--chakra-colors-orange-500)" />
                <Text fontWeight="semibold" fontSize="md" color="orange.700">
                  {daysRemaining} {daysRemaining === 1 ? "day" : "days"}{" "}
                  remaining in your trial
                </Text>
              </HStack>
              <Text fontSize="sm" color="gray.600">
                Upgrade to keep your Growth plan features after the trial ends.
              </Text>
            </VStack>
            <Button
              colorPalette="orange"
              size="md"
              onClick={onUpgrade}
              loading={isLoading}
              disabled={isLoading}
            >
              Upgrade now
            </Button>
          </Flex>

          <Flex gap={2} alignItems="baseline" flexWrap="wrap">
            <Text fontWeight="bold" fontSize="xl">
              {totalPrice}
            </Text>
            <Text fontSize="sm" color="gray.500">
              for {coreMembers} {coreMembers === 1 ? "seat" : "seats"}
            </Text>
            {monthlyEquivalent && (
              <Badge colorPalette="gray" variant="subtle" fontSize="xs">
                {monthlyEquivalent}/seat/mo
              </Badge>
            )}
          </Flex>

          <SimpleGrid
            data-testid="trial-upgrade-features-grid"
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
