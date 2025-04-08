import { HStack, Text } from "@chakra-ui/react";

import { useDrawer } from "./CurrentDrawer";

import { AddOrEditAnnotationScore } from "./annotations/AddOrEditAnnotationScore";
import { Drawer } from "./ui/drawer";

export const AddOrEditAnnotationScoreDrawer = ({
  onClose,
  annotationScoreId,
}: {
  onClose: () => void;
  annotationScoreId?: string | undefined;
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
              {annotationScoreId ? "Edit Score Metric" : "Add Score Metric"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <AddOrEditAnnotationScore onClose={handleClose} annotationScoreId={annotationScoreId} />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
};
