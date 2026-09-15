/** The host address controls the score editor overlay. */

import { HStack, Text } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { AnnotationScoreForm } from "./annotation-score-form.tsx";
import { useAnnotationScoresHost } from "../../model/annotation-scores-host.ts";

export const AnnotationScoreDrawer = ({
  onClose,
  annotationScoreId,
}: {
  onClose?: () => void;
  annotationScoreId?: string | undefined;
}) => {
  const host = useAnnotationScoresHost();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      host.closeEditor();
    }
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={({ open }) => {
        if (!open) {
          handleClose();
        }
      }}
      onInteractOutside={handleClose}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              {annotationScoreId ? "Edit Score Metric" : "Add Score Metric"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <AnnotationScoreForm onClose={handleClose} annotationScoreId={annotationScoreId} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};
