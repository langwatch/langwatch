import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Brain,
  CheckSquare,
  Code,
  Database,
  Shield,
  Star,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type EvaluatorCategoryId =
  | "expected_answer"
  | "llm_judge"
  | "rag"
  | "quality"
  | "safety";

export const evaluatorCategoryNames: Record<EvaluatorCategoryId, string> = {
  expected_answer: "Expected Answer",
  llm_judge: "LLM as Judge",
  rag: "RAG Quality",
  quality: "Quality Aspects",
  safety: "Safety",
};

const evaluatorCategories: ReadonlyArray<{
  id: EvaluatorCategoryId;
  icon: LucideIcon;
  title: string;
  description: string;
}> = [
  {
    id: "expected_answer",
    icon: CheckSquare,
    title: "Expected Answer",
    description: "Compare output against expected values (exact match, similarity)",
  },
  {
    id: "llm_judge",
    icon: Brain,
    title: "LLM as Judge",
    description: "Use LLM to evaluate quality based on criteria",
  },
  {
    id: "rag",
    icon: Database,
    title: "RAG Quality",
    description: "Evaluate retrieval and generation quality",
  },
  {
    id: "quality",
    icon: Star,
    title: "Quality Aspects",
    description: "Check language, structure, and formatting",
  },
  {
    id: "safety",
    icon: Shield,
    title: "Safety",
    description: "Check for PII, prompt injection, and harmful content",
  },
];

export type EvaluatorCategoryPickerProps = {
  onSelectCategory: (category: EvaluatorCategoryId) => void;
  onSelectWorkflow: () => void;
  onSelectCode: () => void;
};

/** Browser-only selection content; navigation and drawer lifetime stay in the host. */
export function EvaluatorCategoryPicker({
  onSelectCategory,
  onSelectWorkflow,
  onSelectCode,
}: EvaluatorCategoryPickerProps) {
  return (
    <VStack gap={4} align="stretch" flex={1} overflowY="auto">
      <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
        Select a category to see available evaluators, or create a custom one.
      </Text>
      <VStack gap={3} align="stretch" paddingX={6} paddingBottom={4}>
        {evaluatorCategories.map((category) => (
          <CategoryCard
            key={category.id}
            {...category}
            onClick={() => onSelectCategory(category.id)}
          />
        ))}
        <Box borderTopWidth="1px" borderColor="border" paddingTop={3}>
          <VStack gap={3} align="stretch">
            <CategoryCard
              id="code"
              icon={Code}
              title="Custom (Code)"
              description="Write a custom Python evaluator"
              onClick={onSelectCode}
            />
            <CategoryCard
              id="workflow"
              icon={Workflow}
              title="Custom (from Workflow)"
              description="Create a new workflow for custom evaluation logic"
              onClick={onSelectWorkflow}
            />
          </VStack>
        </Box>
      </VStack>
    </VStack>
  );
}

function CategoryCard({
  id,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
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
      data-testid={`evaluator-category-${id}`}
    >
      <HStack gap={3} align="start">
        <Box padding={1} borderRadius="md" bg="green.subtle" color="green.fg">
          <Icon size={18} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="500" fontSize="sm">
            {title}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {description}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
