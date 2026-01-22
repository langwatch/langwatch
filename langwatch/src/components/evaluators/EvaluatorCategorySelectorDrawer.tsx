import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Brain,
  CheckSquare,
  Database,
  Shield,
  Star,
  Workflow,
} from "lucide-react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";

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
    description:
      "Compare output against expected values (exact match, similarity)",
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
export function EvaluatorCategorySelectorDrawer(
  props: EvaluatorCategorySelectorDrawerProps,
) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelectCategory =
    props.onSelectCategory ??
    (complexProps.onSelectCategory as EvaluatorCategorySelectorDrawerProps["onSelectCategory"]);
  const onSelectWorkflow =
    props.onSelectWorkflow ??
    (() => openDrawer("workflowSelectorForEvaluator"));
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
            <Heading>Choose Evaluator Category</Heading>
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
              Select a category to see available evaluators, or create a custom
              one from a workflow.
            </Text>

            {/* Category cards */}
            <VStack gap={3} align="stretch" paddingX={6} paddingBottom={4}>
              {evaluatorCategories.map((category) => (
                <CategoryCard
                  key={category.id}
                  {...category}
                  onClick={() => handleSelectCategory(category.id)}
                />
              ))}

              {/* Workflow option - separated */}
              <Box borderTopWidth="1px" borderColor="border" paddingTop={3}>
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
// Category Card Component
// ============================================================================

type CategoryCardProps = {
  id: string;
  icon: typeof CheckSquare;
  title: string;
  description: string;
  onClick: () => void;
};

function CategoryCard({
  id,
  icon: Icon,
  title,
  description,
  onClick,
}: CategoryCardProps) {
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
