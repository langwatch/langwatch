import { HStack, Text } from "@chakra-ui/react";

import { useDrawer } from "./CurrentDrawer";

import { AddAnnotationScore } from "./annotations/AddAnnotationScore";
import { Drawer } from "./ui/drawer";

export const AddAnnotationScoreDrawer = ({
  onClose,
  onOverlayClick,
}: {
  onClose: () => void;
  onOverlayClick: () => void;
}) => {
  const { closeDrawer } = useDrawer();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      closeDrawer();
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
      <Drawer.Content>
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Add Score Metric
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <AddAnnotationScore onClose={handleClose} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};
