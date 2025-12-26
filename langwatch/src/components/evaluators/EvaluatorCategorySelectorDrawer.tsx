import {
  Box,
  Button,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowLeft,
  Brain,
  CheckSquare,
  Database,
  Shield,
  Star,
  Workflow,
} from "lucide-react";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps } from "~/hooks/useDrawer";

export type EvaluatorCategoryId =
  | "expected_answer"
  | "llm_judge"
  | "rag"
  | "quality"
  | "safety";

export type EvaluatorCategorySelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelectCategory?: (category: EvaluatorCategoryId) => void;
  onSelectWorkflow?: () => void;
  onBack?: () => void;
};

const evaluatorCategories: Array<{
  id: EvaluatorCategoryId;
  icon: typeof CheckSquare;
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

/**
 * Drawer for selecting the category of evaluator to create.
 * Shows cards for each evaluator category plus a "Custom (from Workflow)" option.
 */
export function EvaluatorCategorySelectorDrawer(props: EvaluatorCategorySelectorDrawerProps) {
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelectCategory = props.onSelectCategory ?? (complexProps.onSelectCategory as EvaluatorCategorySelectorDrawerProps["onSelectCategory"]);
  const onSelectWorkflow = props.onSelectWorkflow ?? (() => openDrawer("workflowSelectorForEvaluator"));
  const onBack = props.onBack ?? (() => openDrawer("evaluatorList"));
  const isOpen = props.open !== false && props.open !== undefined;

  const handleSelectCategory = (categoryId: EvaluatorCategoryId) => {
    onSelectCategory?.(categoryId);
    openDrawer("evaluatorTypeSelector", { category: categoryId });
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
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              padding={1}
              minWidth="auto"
              data-testid="back-button"
            >
              <ArrowLeft size={20} />
            </Button>
            <Text fontSize="xl" fontWeight="semibold">
              Choose Evaluator Category
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="gray.600" fontSize="sm" paddingX={6} paddingTop={4}>
              Select a category to see available evaluators, or create a custom one from a workflow.
            </Text>

            {/* Category cards */}
            <VStack
              gap={3}
              align="stretch"
              paddingX={6}
              paddingBottom={4}
            >
              {evaluatorCategories.map((category) => (
                <CategoryCard
                  key={category.id}
                  {...category}
                  onClick={() => handleSelectCategory(category.id)}
                />
              ))}

              {/* Workflow option - separated */}
              <Box borderTopWidth="1px" borderColor="gray.200" paddingTop={3}>
                <CategoryCard
                  id="workflow"
                  icon={Workflow}
                  title="Custom (from Workflow)"
                  description="Use an existing workflow as a custom evaluator"
                  onClick={onSelectWorkflow}
                />
              </Box>
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
// Category Card Component
// ============================================================================

type CategoryCardProps = {
  id: string;
  icon: typeof CheckSquare;
  title: string;
  description: string;
  onClick: () => void;
};

function CategoryCard({ id, icon: Icon, title, description, onClick }: CategoryCardProps) {
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
      data-testid={`evaluator-category-${id}`}
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
            {title}
          </Text>
          <Text fontSize="xs" color="gray.600">
            {description}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
