import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import type React from "react";

interface UnsavedLensDialogProps {
  open: boolean;
  lensName: string;
  /**
   * Save the local changes as a brand-new lens (prompts for a name). Omitted
   * where lenses cannot be saved, which drops the button.
   */
  onSaveAsNew?: () => void;
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
  <Dialog
    open={open}
    onClose={onCancel}
    title="Unsaved local changes"
    size="sm"
    showCloseButton={false}
    trapFocus={false}
    preventScroll={false}
    footerContent={
      <HStack gap={2}>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        {onSaveAsNew && (
          <Button colorPalette="orange" variant="solid" size="sm" onClick={onSaveAsNew}>
            Save as new lens…
          </Button>
        )}
      </HStack>
    }
  >
    <Text color="fg.muted" fontSize="sm">
      You have unsaved local changes on <strong>{lensName}</strong>. Save them as a new lens, or
      discard and switch?
    </Text>
  </Dialog>
);
