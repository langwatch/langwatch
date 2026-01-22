import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { Evaluator } from "@prisma/client";
import { CheckCircle, ChevronRight } from "lucide-react";

export type EvaluatorSelectionBoxProps = {
  /** The currently selected evaluator, or null if none selected */
  selectedEvaluator: Evaluator | null;
  /** Called when the user clicks to select an evaluator (no evaluator selected) */
  onSelectClick: () => void;
  /** Called when the user clicks on an already-selected evaluator (to edit it) */
  onEditClick?: () => void;
  /** Placeholder text when no evaluator is selected */
  placeholder?: string;
  /** Show the evaluator slug badge (useful for guardrails) */
  showSlug?: boolean;
};

/**
 * Reusable component for selecting an evaluator.
 * - When no evaluator is selected: shows placeholder, clicking opens evaluator list
 * - When evaluator is selected: shows evaluator name, clicking opens evaluator editor
 */
export function EvaluatorSelectionBox({
  selectedEvaluator,
  onSelectClick,
  onEditClick,
  placeholder = "Select Evaluator",
  showSlug = false,
}: EvaluatorSelectionBoxProps) {
  if (selectedEvaluator) {
    // When evaluator is selected, clicking opens the editor (not the list)
    const handleClick = onEditClick ?? onSelectClick;

    return (
      <Button
        onClick={handleClick}
        variant="outline"
        width="full"
        paddingX={4}
        borderRadius="xl"
        cursor="pointer"
        size="2xl"
        fontSize="14px"
        boxShadow="inset 0 -2px 5px 0px rgba(0, 0, 0, 0.03)"
      >
        <HStack justify="space-between" width="full">
          <HStack gap={3}>
            <Box color="green.500">
              <CheckCircle size={20} />
            </Box>
            <VStack width="full" align="start" lineHeight={1} textAlign="left">
              <Text fontWeight="medium" lineClamp={1}>{selectedEvaluator.name}</Text>
              {showSlug && selectedEvaluator.slug && (
                <Text fontSize="xs" color="gray.500" fontFamily="mono" fontWeight="normal" lineClamp={1}>
                  {selectedEvaluator.slug}
                </Text>
              )}
            </VStack>
          </HStack>
          <Box color="gray.400">
            <ChevronRight size={20} />
          </Box>
        </HStack>
      </Button>
    );
  }

  return (
    <Button
      onClick={onSelectClick}
      variant="outline"
      width="full"
      paddingX={4}
      borderRadius="xl"
      cursor="pointer"
      size="2xl"
      fontSize="14px"
      boxShadow="inset 0 -2px 5px 0px rgba(0, 0, 0, 0.03)"
    >
      <HStack justify="space-between" width="full">
        <Text color="gray.500">{placeholder}</Text>
        <Box color="gray.400">
          <ChevronRight size={20} />
        </Box>
      </HStack>
    </Button>
  );
}
