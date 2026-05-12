import { Button, Heading, HStack } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";
import {
  categoryNames,
  EvaluatorTypeSelectorContent,
} from "./EvaluatorTypeSelectorContent";

export type EvaluatorTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluatorType: string) => void;
  category?: EvaluatorCategoryId;
};

/**
 * Drawer for selecting a specific evaluator type within a category.
 * Shows a list of evaluators for the selected category.
 */
export function EvaluatorTypeSelectorDrawer(
  props: EvaluatorTypeSelectorDrawerProps,
) {
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as EvaluatorTypeSelectorDrawerProps["onSelect"]);
  const category =
    props.category ??
    (drawerParams.category as EvaluatorCategoryId | undefined) ??
    (complexProps.category as EvaluatorCategoryId | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

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
          <EvaluatorTypeSelectorContent
            category={category}
            onSelect={onSelect}
            onClose={onClose}
          />
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
