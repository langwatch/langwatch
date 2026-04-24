import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import {
  Brain,
  CheckSquare,
  Database,
  Shield,
  Star,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import {
  EvaluatorEditorBody,
  EvaluatorEditorFooter,
  EvaluatorEditorHeading,
  useEvaluatorEditorController,
} from "./EvaluatorEditorShared";
import {
  categoryNames,
  EvaluatorTypeSelectorContent,
} from "./EvaluatorTypeSelectorContent";

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

type View =
  | { step: "category" }
  | { step: "type"; category: EvaluatorCategoryId }
  | {
      step: "editor";
      category: EvaluatorCategoryId;
      evaluatorType: string;
    };

const STEP_ORDER: Record<View["step"], number> = {
  category: 0,
  type: 1,
  editor: 2,
};

const SLIDE_VARIANTS: Variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
  }),
  center: {
    x: 0,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? "-100%" : "100%",
  }),
};

const SLIDE_TRANSITION = {
  type: "spring" as const,
  stiffness: 420,
  damping: 42,
  mass: 1,
};

const PANEL_STYLE = {
  position: "absolute" as const,
  inset: 0,
  display: "flex",
  flexDirection: "column" as const,
  overflow: "hidden" as const,
};

/**
 * Unified drawer for the new-evaluator flow.
 *
 * Hosts all three steps (category → type → editor) inside a single
 * Drawer.Root with a shared direction-aware slide animation between them.
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
  const isOpen = props.open === true;

  const [view, setView] = useState<View>({ step: "category" });

  useEffect(() => {
    if (!isOpen) setView({ step: "category" });
  }, [isOpen]);

  const currentStepIndex = STEP_ORDER[view.step];
  const prevStepIndexRef = useRef(currentStepIndex);
  const direction = currentStepIndex >= prevStepIndexRef.current ? 1 : -1;
  useEffect(() => {
    prevStepIndexRef.current = currentStepIndex;
  }, [currentStepIndex]);

  const editorIsActive = view.step === "editor";
  const editorEvaluatorType = editorIsActive ? view.evaluatorType : undefined;
  const editorCategory = editorIsActive ? view.category : undefined;
  const editorController = useEvaluatorEditorController({
    open: isOpen && editorIsActive,
    onClose,
    evaluatorType: editorEvaluatorType,
    category: editorCategory,
    isOpen: isOpen && editorIsActive,
  });

  const handleSelectCategory = (categoryId: EvaluatorCategoryId) => {
    onSelectCategory?.(categoryId);
    setView({ step: "type", category: categoryId });
  };

  const handleSelectEvaluator =
    (category: EvaluatorCategoryId) => (evaluatorType: string) => {
      setView({ step: "editor", category, evaluatorType });
    };

  const handleBack = () => {
    if (view.step === "editor") {
      // Unmounting the editor cancels the trailing debounce, so flush any
      // pending local-config update before we navigate back.
      editorController.flushLocalConfig();
      setView({ step: "type", category: view.category });
      return;
    }
    if (view.step === "type") {
      setView({ step: "category" });
      return;
    }
    if (canGoBack) goBack();
  };

  const showBackButton = view.step !== "category" || canGoBack;
  const headerContent =
    view.step === "editor" ? (
      <EvaluatorEditorHeading controller={editorController} />
    ) : (
      <Heading>
        {view.step === "type"
          ? categoryNames[view.category]
          : "Choose Evaluator Category"}
      </Heading>
    );

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="lg"
      modal={false}
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2} minH="32px">
            {showBackButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <LuArrowLeft size={20} />
              </Button>
            )}
            {headerContent}
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
          position="relative"
        >
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            {view.step === "category" && (
              <motion.div
                key="category"
                custom={direction}
                variants={SLIDE_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={SLIDE_TRANSITION}
                style={PANEL_STYLE}
              >
                <VStack gap={4} align="stretch" flex={1} overflowY="auto">
                  <Text
                    color="fg.muted"
                    fontSize="sm"
                    paddingX={6}
                    paddingTop={4}
                  >
                    Select a category to see available evaluators, or create a
                    custom one from a workflow.
                  </Text>

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

                    <Box
                      borderTopWidth="1px"
                      borderColor="border"
                      paddingTop={3}
                    >
                      <CategoryCard
                        id="workflow"
                        icon={Workflow}
                        title="Custom (from Workflow)"
                        description="Create a new workflow for custom evaluation logic"
                        onClick={onSelectWorkflow}
                      />
                    </Box>
                  </VStack>
                </VStack>
              </motion.div>
            )}
            {view.step === "type" && (
              <motion.div
                key={`type-${view.category}`}
                custom={direction}
                variants={SLIDE_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={SLIDE_TRANSITION}
                style={PANEL_STYLE}
              >
                <EvaluatorTypeSelectorContent
                  category={view.category}
                  onSelect={handleSelectEvaluator(view.category)}
                  onClose={onClose}
                />
              </motion.div>
            )}
            {view.step === "editor" && (
              <motion.div
                key={`editor-${view.evaluatorType}`}
                custom={direction}
                variants={SLIDE_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={SLIDE_TRANSITION}
                style={PANEL_STYLE}
              >
                <EvaluatorEditorBody controller={editorController} />
              </motion.div>
            )}
          </AnimatePresence>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          {view.step === "editor" ? (
            <EvaluatorEditorFooter
              controller={editorController}
              onCancel={onClose}
            />
          ) : (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

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
