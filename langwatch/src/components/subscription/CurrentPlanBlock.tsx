/**
 * Current Plan Block - displays the active subscription
 */
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check } from "lucide-react";
import { Link } from "~/components/ui/link";
import { PricingSummary } from "./PricingSummary";

export function CurrentPlanBlock({
  planName,
  pricing,
  features,
  userCount,
  maxSeats,
  upgradeRequired,
  onUserCountClick,
  onManageSubscription,
  isManageLoading,
  deprecatedNotice,
}: {
  planName: string;
  pricing?: {
    totalPrice: string;
    seatCount: number;
    perSeatPrice?: string | null;
  };
  features?: string[];
  userCount: number;
  maxSeats?: number;
  upgradeRequired?: boolean;
  onUserCountClick?: () => void;
  onManageSubscription?: () => void;
  isManageLoading?: boolean;
  deprecatedNotice?: boolean;
}) {
  return (
    <Card.Root
      data-testid="current-plan-block"
      borderWidth={1}
      borderColor="gray.200"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5}>
          <Flex justifyContent="space-between" alignItems="flex-start">
            <VStack align="start" gap={1}>
              <HStack gap={3}>
                <Text fontWeight="semibold" fontSize="lg">
                  {planName}
                </Text>
                <Badge
                  colorPalette="blue"
                  variant="outline"
                  borderRadius="md"
                  paddingX={2}
                  paddingY={0.5}
                  fontSize="xs"
                >
                  Current
                </Badge>
                {upgradeRequired && (
                  <Badge
                    colorPalette="orange"
                    variant="subtle"
                    borderRadius="md"
                    paddingX={2}
                    paddingY={0.5}
                    fontSize="xs"
                  >
                    Upgrade required
                  </Badge>
                )}
              </HStack>
              {pricing && (
                <PricingSummary
                  totalPrice={pricing.totalPrice}
                  seatCount={pricing.seatCount}
                  perSeatPrice={pricing.perSeatPrice}
                />
              )}
            </VStack>
            <VStack align="end" gap={0}>
              <Text color="gray.500" fontSize="sm">
                Users
              </Text>
              <Box
                as="button"
                onClick={onUserCountClick}
                textDecoration="underline"
                _hover={{ color: "blue.600", cursor: "pointer" }}
                color="gray.900"
              >
                <Text
                  fontWeight="semibold"
                  fontSize="lg"
                  data-testid="user-count-link"
                >
                  {maxSeats != null ? `${userCount}/${maxSeats}` : userCount}
                </Text>
              </Box>
            </VStack>
          </Flex>
          {features && (
            <SimpleGrid
              data-testid="current-plan-features-grid"
              templateColumns={{ base: "1fr", md: "1fr 1.4fr 1fr" }}
              gap={3}
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
          )}
          {deprecatedNotice && (
            <Box data-testid="tiered-deprecated-notice" paddingTop={1}>
              <Text fontSize="sm" color="gray.600">
                You are on a legacy tiered pricing model.{" "}
                <Link
                  href="/settings/plans"
                  fontWeight="semibold"
                  color="gray.800"
                  _hover={{ color: "gray.900" }}
                >
                  Update your plan
                </Link>{" "}
                to move to seat and usage billing.
              </Text>
            </Box>
          )}
          {onManageSubscription && (
            <Button
              data-testid="manage-subscription-button"
              variant="outline"
              size="sm"
              onClick={onManageSubscription}
              loading={isManageLoading}
              disabled={isManageLoading}
            >
              Manage Subscription
            </Button>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
