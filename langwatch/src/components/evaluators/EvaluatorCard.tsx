import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CheckSquare, Workflow } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Evaluator } from "@prisma/client";

const evaluatorTypeIcons: Record<string, typeof CheckSquare> = {
  evaluator: CheckSquare,
  workflow: Workflow,
};

const evaluatorTypeLabels: Record<string, string> = {
  evaluator: "Built-in",
  workflow: "Workflow",
};

export type EvaluatorCardProps = {
  evaluator: Evaluator;
  onClick?: () => void;
};

export function EvaluatorCard({ evaluator, onClick }: EvaluatorCardProps) {
  const Icon = evaluatorTypeIcons[evaluator.type] ?? CheckSquare;
  const typeLabel = evaluatorTypeLabels[evaluator.type] ?? evaluator.type;

  // Extract evaluator type from config if available
  const config = evaluator.config as { evaluatorType?: string } | null;
  const evaluatorType = config?.evaluatorType;

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "green.400", bg: "green.50" }}
      transition="all 0.15s"
      data-testid={`evaluator-card-${evaluator.id}`}
    >
      <HStack gap={3} align="start">
        <Box
          padding={2}
          borderRadius="md"
          bg="green.50"
          color="green.600"
        >
          <Icon size={20} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="semibold" fontSize="sm">
            {evaluator.name}
          </Text>
          <HStack gap={2} fontSize="xs" color="gray.500">
            <Text>{typeLabel}</Text>
            {evaluatorType && (
              <>
                <Text>•</Text>
                <Text>{evaluatorType}</Text>
              </>
            )}
            <Text>•</Text>
            <Text>
              Updated {formatDistanceToNow(new Date(evaluator.updatedAt), { addSuffix: true })}
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}

