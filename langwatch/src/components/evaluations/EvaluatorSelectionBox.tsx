import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { CheckCircle, X } from "lucide-react";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";

export type EvaluatorSelectionBoxProps = {
  /** The currently selected evaluator, or null if none selected */
  selectedEvaluator: Evaluator | null;
  /** Called when the user clicks to select an evaluator */
  onSelectClick: () => void;
  /** Called when the user clicks to clear the selection. If not provided, no clear button is shown. */
  onClear?: () => void;
  /** Placeholder text when no evaluator is selected */
  placeholder?: string;
  /** Description text when no evaluator is selected */
  placeholderDescription?: string;
  /** Show the evaluator slug badge (useful for guardrails) */
  showSlug?: boolean;
};

/**
 * Reusable component for selecting an evaluator.
 * Shows a button to select when empty, or displays the selected evaluator with optional clear button.
 */
export function EvaluatorSelectionBox({
  selectedEvaluator,
  onSelectClick,
  onClear,
  placeholder = "Select Evaluator",
  placeholderDescription = "Choose an evaluator to continue",
  showSlug = false,
}: EvaluatorSelectionBoxProps) {
  // Get evaluator type info for display
  const evaluatorConfig = selectedEvaluator?.config as {
    evaluatorType?: string;
  } | null;
  const evaluatorType = evaluatorConfig?.evaluatorType as EvaluatorTypes | undefined;
  const evaluatorDef = evaluatorType ? AVAILABLE_EVALUATORS[evaluatorType] : undefined;

  if (selectedEvaluator) {
    return (
      <Box
        padding={4}
        borderWidth={1}
        borderRadius="md"
        borderColor="green.200"
        backgroundColor="green.50"
      >
        <HStack justify="space-between">
          <HStack gap={3}>
            <Box color="green.500">
              <CheckCircle size={20} />
            </Box>
            <VStack align="start" gap={0}>
              <HStack gap={2}>
                <Text fontWeight="medium">{selectedEvaluator.name}</Text>
                {showSlug && selectedEvaluator.slug && (
                  <Text fontSize="xs" color="gray.500" fontFamily="mono">
                    {selectedEvaluator.slug}
                  </Text>
                )}
              </HStack>
              {evaluatorDef && (
                <Text fontSize="sm" color="gray.600">
                  {evaluatorDef.description}
                </Text>
              )}
            </VStack>
          </HStack>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onSelectClick}>
              Change
            </Button>
            {onClear && (
              <Button size="sm" variant="ghost" onClick={onClear}>
                <X size={16} />
              </Button>
            )}
          </HStack>
        </HStack>
      </Box>
    );
  }

  return (
    <Button
      variant="outline"
      width="full"
      height="auto"
      paddingY={4}
      onClick={onSelectClick}
      borderStyle="dashed"
    >
      <VStack gap={1}>
        <Text fontWeight="medium">{placeholder}</Text>
        <Text fontSize="sm" color="gray.500">
          {placeholderDescription}
        </Text>
      </VStack>
    </Button>
  );
}
