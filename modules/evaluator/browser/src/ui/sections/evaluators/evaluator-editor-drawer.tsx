import { useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";

import {
  EvaluatorEditorBody,
  type EvaluatorEditorDrawerProps,
  evaluatorEditorFooter,
  EvaluatorEditorHeading,
  useEvaluatorEditorController,
} from "./evaluator-editor-shared.tsx";

/**
 * Drawer for creating/editing a built-in evaluator.
 * Shows a name input and settings based on the evaluator type's schema.
 */
export function EvaluatorEditorDrawer(props: EvaluatorEditorDrawerProps) {
  const { canGoBack, goBack } = useDrawer();
  const isOpen = props.open !== false && props.open !== undefined;

  const controller = useEvaluatorEditorController({ ...props, isOpen });

  return (
    <Drawer
      open={isOpen}
      onClose={controller.handleClose}
      onBack={canGoBack ? goBack : void 0}
      backButtonTestId="back-button"
      size="lg"
      title={controller.title}
      titleContent={<EvaluatorEditorHeading controller={controller} />}
      body="flush"
      bodyScroll="content"
      footer={evaluatorEditorFooter({ controller })}
    >
      <EvaluatorEditorBody controller={controller} />
    </Drawer>
  );
}
