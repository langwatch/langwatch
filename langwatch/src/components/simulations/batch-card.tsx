import { Card, Badge, HStack, VStack, Text } from "@chakra-ui/react";

export interface BatchCardProps {
  title?: string;
  description?: string;
  successRate: number; // 0-100 percentage
  scenarioCount: number;
  lastRunAt: Date;
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
    if (rate >= 50) return "orange";
    return "red";
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card.Root
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      borderRadius="lg"
      p="6"
      _hover={{ borderColor: "gray.300", transform: "translateY(-2px)" }}
      transition="all 0.2s"
      cursor={!!onClick ? "pointer" : "auto"}
      onClick={onClick}
    >
      <VStack align="stretch" gap="4">
        {/* Header with title and success rate */}
        <HStack justify="space-between" align="start">
          <Text fontWeight="bold" fontSize="lg" color="gray.900">
            {title}
          </Text>
          <Badge colorPalette={getSuccessColor(successRate)} variant="solid">
            {successRate}% Success
          </Badge>
        </HStack>

        {/* Description */}
        <Text fontSize="sm" color="gray.600">
          {description}
        </Text>

        {/* Footer with stats and run button */}
        <HStack justify="space-between" align="center">
          <VStack align="start" gap="1">
            <Text fontSize="sm" fontWeight="medium" color="gray.900">
              {scenarioCount} scenario{scenarioCount !== 1 ? "s" : ""}
            </Text>
            <Text fontSize="sm" color="gray.500">
              Last run: {formatDate(lastRunAt)}
            </Text>
          </VStack>
        </HStack>
      </VStack>
    </Card.Root>
  );
}
