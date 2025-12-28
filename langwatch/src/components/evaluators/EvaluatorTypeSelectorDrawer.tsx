import {
  Box,
  Button,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps, useDrawerParams } from "~/hooks/useDrawer";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";

export type EvaluatorTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluatorType: string) => void;
  category?: EvaluatorCategoryId;
};

/**
 * Mapping of category IDs to evaluator types
 */
const categoryEvaluators: Record<EvaluatorCategoryId, (keyof typeof AVAILABLE_EVALUATORS)[]> = {
  expected_answer: [
    "langevals/exact_match",
    "langevals/llm_answer_match",
    "ragas/factual_correctness",
    "ragas/rouge_score",
    "ragas/bleu_score",
  ],
  llm_judge: [
    "langevals/llm_boolean",
    "langevals/llm_score",
    "langevals/llm_category",
  ],
  rag: [
    "ragas/faithfulness",
    "ragas/response_relevancy",
    "ragas/response_context_recall",
    "ragas/response_context_precision",
    "ragas/context_f1",
  ],
  quality: [
    "lingua/language_detection",
    "ragas/summarization_score",
    "langevals/valid_format",
  ],
  safety: [
    "presidio/pii_detection",
    "azure/prompt_injection",
    "azure/content_safety",
  ],
};

/**
 * Category display names
 */
const categoryNames: Record<EvaluatorCategoryId, string> = {
  expected_answer: "Expected Answer",
  llm_judge: "LLM as Judge",
  rag: "RAG Quality",
  quality: "Quality Aspects",
  safety: "Safety",
};

/**
 * Drawer for selecting a specific evaluator type within a category.
 * Shows a list of evaluators for the selected category.
 */
export function EvaluatorTypeSelectorDrawer(props: EvaluatorTypeSelectorDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect = props.onSelect ?? (complexProps.onSelect as EvaluatorTypeSelectorDrawerProps["onSelect"]);
  // Get category from props, URL params, or complexProps (in that order)
  const category = props.category ?? (drawerParams.category as EvaluatorCategoryId | undefined) ?? (complexProps.category as EvaluatorCategoryId | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  const evaluatorTypes = category ? categoryEvaluators[category] ?? [] : [];

  const handleSelectEvaluator = (evaluatorType: string) => {
    onSelect?.(evaluatorType);
    openDrawer("evaluatorEditor", { evaluatorType, category });
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {canGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <LuArrowLeft size={20} />
              </Button>
            )}
            <Heading>
              {category ? categoryNames[category] : "Select Evaluator"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="gray.600" fontSize="sm" paddingX={6} paddingTop={4}>
              Select an evaluator to configure and save.
            </Text>

            {/* Evaluator cards */}
            <VStack
              gap={3}
              align="stretch"
              paddingX={6}
              paddingBottom={4}
              overflowY="auto"
            >
              {evaluatorTypes.map((evaluatorType) => {
                const evaluator = AVAILABLE_EVALUATORS[evaluatorType];
                if (!evaluator) return null;

                return (
                  <EvaluatorCard
                    key={evaluatorType}
                    evaluatorType={evaluatorType}
                    name={evaluator.name}
                    description={evaluator.description}
                    onClick={() => handleSelectEvaluator(evaluatorType)}
                  />
                );
              })}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Evaluator Card Component
// ============================================================================

type EvaluatorCardProps = {
  evaluatorType: string;
  name: string;
  description: string;
  onClick: () => void;
};

function EvaluatorCard({ evaluatorType, name, description, onClick }: EvaluatorCardProps) {
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
      data-testid={`evaluator-type-${evaluatorType.replace("/", "-")}`}
    >
      <VStack align="start" gap={1}>
        <Text fontWeight="500" fontSize="sm">
          {name}
        </Text>
        <Text fontSize="xs" color="gray.600" lineClamp={2}>
          {description}
        </Text>
      </VStack>
    </Box>
  );
}
