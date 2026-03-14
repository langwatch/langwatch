import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";

export type EvaluatorTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluatorType: string) => void;
  category?: EvaluatorCategoryId;
};

/**
 * Maps every evaluator to a UI category. TypeScript enforces exhaustiveness:
 * adding a new evaluator to AVAILABLE_EVALUATORS without mapping it here
 * causes a compile error.
 *
 * Use "ignored" for evaluators that should not appear in the selector
 * (e.g. custom/basic, legacy, internal).
 */
const evaluatorCategoryMap: Record<
  keyof typeof AVAILABLE_EVALUATORS,
  EvaluatorCategoryId | "ignored"
> = {
  // Expected Answer
  "langevals/exact_match": "expected_answer",
  "langevals/llm_answer_match": "expected_answer",
  "ragas/factual_correctness": "expected_answer",
  "ragas/rouge_score": "expected_answer",
  "ragas/bleu_score": "expected_answer",

  // LLM Judge
  "langevals/llm_boolean": "llm_judge",
  "langevals/llm_score": "llm_judge",
  "langevals/llm_category": "llm_judge",

  // RAG
  "ragas/faithfulness": "rag",
  "ragas/response_relevancy": "rag",
  "ragas/response_context_recall": "rag",
  "ragas/response_context_precision": "rag",
  "ragas/context_f1": "rag",

  // Quality
  "langevals/sentiment": "quality",
  "lingua/language_detection": "quality",
  "ragas/summarization_score": "quality",
  "langevals/valid_format": "quality",
  "langevals/query_resolution": "quality",
  "ragas/sql_query_equivalence": "quality",
  "ragas/rubrics_based_scoring": "llm_judge",

  // Safety
  "presidio/pii_detection": "safety",
  "azure/prompt_injection": "safety",
  "azure/jailbreak": "safety",
  "azure/content_safety": "safety",
  "openai/moderation": "safety",
  "langevals/competitor_blocklist": "safety",
  "langevals/competitor_llm": "safety",
  "langevals/competitor_llm_function_call": "safety",
  "langevals/off_topic": "safety",

  // Ignored — custom templates, legacy, or internal
  "langevals/basic": "ignored",
  "langevals/similarity": "ignored",
  "legacy/ragas_answer_correctness": "ignored",
  "legacy/ragas_answer_relevancy": "ignored",
  "legacy/ragas_context_precision": "ignored",
  "legacy/ragas_context_recall": "ignored",
  "legacy/ragas_context_relevancy": "ignored",
  "legacy/ragas_context_utilization": "ignored",
  "legacy/ragas_faithfulness": "ignored",
  "ragas/context_precision": "ignored",
  "ragas/context_recall": "ignored",
};

function buildCategoryEvaluators(): Record<
  EvaluatorCategoryId,
  (keyof typeof AVAILABLE_EVALUATORS)[]
> {
  const result: Record<string, (keyof typeof AVAILABLE_EVALUATORS)[]> = {};
  for (const [evaluator, category] of Object.entries(evaluatorCategoryMap)) {
    if (category === "ignored") continue;
    (result[category] ??= []).push(
      evaluator as keyof typeof AVAILABLE_EVALUATORS,
    );
  }
  return result as Record<
    EvaluatorCategoryId,
    (keyof typeof AVAILABLE_EVALUATORS)[]
  >;
}

const categoryEvaluators = buildCategoryEvaluators();

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
export function EvaluatorTypeSelectorDrawer(
  props: EvaluatorTypeSelectorDrawerProps,
) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as EvaluatorTypeSelectorDrawerProps["onSelect"]);
  // Get category from props, URL params, or complexProps (in that order)
  const category =
    props.category ??
    (drawerParams.category as EvaluatorCategoryId | undefined) ??
    (complexProps.category as EvaluatorCategoryId | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  const evaluatorTypes = category ? (categoryEvaluators[category] ?? []) : [];

  const handleSelectEvaluator = (evaluatorType: string) => {
    onSelect?.(evaluatorType);
    openDrawer("evaluatorEditor", { evaluatorType, category });
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
      modal={false}
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
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
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
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
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

function EvaluatorCard({
  evaluatorType,
  name,
  description,
  onClick,
}: EvaluatorCardProps) {
  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "green.muted", bg: "green.subtle" }}
      transition="all 0.15s"
      data-testid={`evaluator-type-${evaluatorType.replace("/", "-")}`}
    >
      <VStack align="start" gap={1}>
        <Text fontWeight="500" fontSize="sm">
          {name}
        </Text>
        <Text fontSize="xs" color="fg.muted" lineClamp={2}>
          {description}
        </Text>
      </VStack>
    </Box>
  );
}
