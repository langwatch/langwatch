import { getComplexProps, useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box } from "@langwatch/design-system/primitives";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";

import {
  EvaluatorCategoryPicker,
  type EvaluatorCategoryId,
} from "../../blocks/evaluator-category-picker.tsx";
import {
  EvaluatorEditorBody,
  evaluatorEditorFooter,
  EvaluatorEditorHeading,
  useEvaluatorEditorController,
} from "./evaluator-editor-shared.tsx";
import { categoryNames, EvaluatorTypeSelectorContent } from "./evaluator-type-selector-content.tsx";

/** What a caller hands evaluator's category selector drawer. */
export type EvaluatorCategorySelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelectCategory?: (category: EvaluatorCategoryId) => void;
  onSelectWorkflow?: () => void;
  onSelectCode?: () => void;
};

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
 * Unified drawer for the new-evaluator flow. Hosts all three steps (category → type → editor)
 * inside a single Drawer.Root with a shared direction-aware slide animation between them.
 */
export function EvaluatorCategorySelectorDrawer(props: EvaluatorCategorySelectorDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelectCategory =
    props.onSelectCategory ??
    (complexProps.onSelectCategory as EvaluatorCategorySelectorDrawerProps["onSelectCategory"]);
  const onSelectWorkflow =
    props.onSelectWorkflow ?? (() => openDrawer("workflowSelectorForEvaluator"));
  const onSelectCode = props.onSelectCode ?? (() => openDrawer("codeEvaluatorEditor"));
  const isOpen = props.open !== false && props.open !== undefined;

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

  const handleSelectEvaluator = (category: EvaluatorCategoryId) => (evaluatorType: string) => {
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
  const title = drawerTitle({ view, editorTitle: editorController.title });

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      onBack={showBackButton ? handleBack : void 0}
      backButtonTestId="back-button"
      size="lg"
      title={title}
      titleContent={
        view.step === "editor" ? <EvaluatorEditorHeading controller={editorController} /> : void 0
      }
      body="flush"
      bodyScroll="content"
      footer={
        view.step === "editor"
          ? evaluatorEditorFooter({ controller: editorController, onCancel: onClose })
          : { cancel: { onClick: onClose } }
      }
    >
      <Box position="relative" display="flex" flexDirection="column" flex={1} overflow="hidden">
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
              <EvaluatorCategoryPicker
                onSelectCategory={handleSelectCategory}
                onSelectCode={onSelectCode}
                onSelectWorkflow={onSelectWorkflow}
              />
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
      </Box>
    </Drawer>
  );
}

function drawerTitle({ view, editorTitle }: { view: View; editorTitle: string }) {
  if (view.step === "type") return categoryNames[view.category];
  if (view.step === "editor") return editorTitle;
  return "Choose Evaluator Category";
}
