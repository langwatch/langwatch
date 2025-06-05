import { Card, Badge, HStack, VStack, Text, Box } from "@chakra-ui/react";
import { BoxIcon } from "lucide-react";
import { Settings, Clock } from "react-feather";

export interface BatchCardProps {
  title?: string;
  description?: string;
  successRate: number; // 0-100 percentage
  scenarioCount: number;
  lastRunAt: Date | null;
  onClick: () => void;
}

export function BatchCard({
  title,
  description,
  successRate,
  scenarioCount,
  lastRunAt,
  onClick,
}: BatchCardProps) {
  const getSuccessColor = (rate: number) => {
    if (rate >= 90) return "green";
    if (rate >= 70) return "orange";
    return "red";
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "Unknown";

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  };

  return (
    <Card.Root
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      borderRadius="lg"
      p="5"
      _hover={{
        borderColor: "gray.300",
        transform: "translateY(-1px)",
        shadow: "sm",
      }}
      transition="all 0.15s ease"
      cursor="pointer"
      onClick={onClick}
      position="relative"
    >
      <VStack align="stretch" gap="4">
        {/* Header row with icon, title, and success badge */}
        <HStack justify="space-between" align="start">
          <HStack gap="3" align="center" flex="1" minWidth="0">
            <Text fontWeight="600" fontSize="md" color="gray.900" lineClamp={1}>
              {title}
            </Text>
          </HStack>
          <Badge
            colorPalette={getSuccessColor(successRate)}
            variant="solid"
            fontSize="xs"
            fontWeight="600"
            flexShrink={0}
          >
            {successRate}% Success
          </Badge>
        </HStack>

        {/* Scenarios section */}
        <HStack align="start" gap="1">
          <Text fontSize="xl" fontWeight="700" color="gray.900">
            {scenarioCount} scenarios
          </Text>
        </HStack>

        {/* Timestamp */}
        <HStack gap="2" align="center" color="gray.500">
          <Text fontSize="xs" textTransform="uppercase">
            Last run: {formatDate(lastRunAt)}
          </Text>
        </HStack>
      </VStack>
    </Card.Root>
  );
}
