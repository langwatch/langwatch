import { Button, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "../../../../components/ui/dialog";

interface UnsavedLensDialogProps {
  open: boolean;
  lensName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export const UnsavedLensDialog: React.FC<UnsavedLensDialogProps> = ({
  open,
  lensName,
  onSave,
  onDiscard,
  onCancel,
}) => (
  <DialogRoot
    open={open}
    onOpenChange={(e) => {
      if (!e.open) onCancel();
    }}
    size="sm"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Unsaved changes</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Text color="fg.muted" fontSize="sm">
          You have unsaved changes on <strong>{lensName}</strong>. Would you
          like to save or discard them?
        </Text>
      </DialogBody>
      <DialogFooter>
        <HStack gap={2}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={onDiscard}>
            Discard
          </Button>
          <Button colorPalette="blue" size="sm" onClick={onSave}>
            Save
          </Button>
        </HStack>
      </DialogFooter>
    </DialogContent>
  </DialogRoot>
);
