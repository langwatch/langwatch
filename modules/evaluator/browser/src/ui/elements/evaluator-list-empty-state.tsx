import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { CheckCircle, Plus } from "lucide-react";

export type EvaluatorListEmptyStateProps = {
  onCreateNew: () => void;
  itemLabel: string;
  hasHiddenAll: boolean;
};

export function EvaluatorListEmptyState({
  onCreateNew,
  itemLabel,
  hasHiddenAll,
}: EvaluatorListEmptyStateProps) {
  return (
    <VStack paddingY={24} gap={4} textAlign="center">
      <Box padding={4} borderRadius="full" bg="green.subtle" color="green.fg">
        <CheckCircle size={32} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="medium" color="fg">
          {hasHiddenAll ? `Every ${itemLabel} is already attached` : `No ${itemLabel}s yet`}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {hasHiddenAll
            ? `Every ${itemLabel} the project has is already attached here`
            : `Create your first ${itemLabel} to get started`}
        </Text>
      </VStack>
      {!hasHiddenAll && (
        <Button
          colorScheme="blue"
          onClick={onCreateNew}
          data-testid="create-first-evaluator-button"
        >
          <Plus size={16} />
          {`Create your first ${itemLabel}`}
        </Button>
      )}
    </VStack>
  );
}
