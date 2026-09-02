/**
 * The score editor, as an overlay.
 *
 * MOVED FROM `platform/app/src/components/AddOrEditAnnotationScoreDrawer.tsx`,
 * which had already stopped compiling: the form it wrapped left that
 * application with the annotations move, so the file was a wrapper around an
 * import that no longer resolved.
 *
 * IT CLOSES THROUGH THE HOST rather than through a drawer navigator. `onClose`
 * is optional here because a drawer registry supplies one and a directly
 * mounted overlay does not; either way the address the host holds is what
 * decides whether this is on screen at all.
 */

import { HStack, Text } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { AnnotationScoreForm } from "./annotation-score-form";
import { useAnnotationScoresHost } from "./annotation-scores-host";

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
