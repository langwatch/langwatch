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
  /** Save the local changes as a brand-new lens (prompts for a name). */
  onSaveAsNew: () => void;
  /** Discard local changes — revert to the saved lens definition. */
  onDiscard: () => void;
  onCancel: () => void;
}

export const UnsavedLensDialog: React.FC<UnsavedLensDialogProps> = ({
  open,
  lensName,
  onSaveAsNew,
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
        <DialogTitle>Unsaved local changes</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Text color="fg.muted" fontSize="sm">
          You have unsaved local changes on <strong>{lensName}</strong>. Save
          them as a new lens, or discard and switch?
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
          <Button colorPalette="blue" size="sm" onClick={onSaveAsNew}>
            Save as new lens…
          </Button>
        </HStack>
      </DialogFooter>
    </DialogContent>
  </DialogRoot>
);
