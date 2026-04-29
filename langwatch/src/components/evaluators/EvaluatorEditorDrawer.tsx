import { Button, HStack } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";

import {
  type EvaluatorEditorDrawerProps,
  EvaluatorEditorBody,
  EvaluatorEditorFooter,
  EvaluatorEditorHeading,
  useEvaluatorEditorController,
} from "./EvaluatorEditorShared";

/**
 * Drawer for creating/editing a built-in evaluator.
 * Shows a name input and settings based on the evaluator type's schema.
 */
export function EvaluatorEditorDrawer(props: EvaluatorEditorDrawerProps) {
  const { canGoBack, goBack } = useDrawer();
  const isOpen = props.open !== false && props.open !== undefined;

  const controller = useEvaluatorEditorController({ ...props, isOpen });

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && controller.handleClose()}
      size="lg"
      closeOnInteractOutside={false}
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
            <EvaluatorEditorHeading controller={controller} />
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <EvaluatorEditorBody controller={controller} />
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <EvaluatorEditorFooter controller={controller} />
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
