import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useRef, useState } from "react";

/** Shared destructive-action confirmation for app-owned feature composition. */
export function DeleteConfirmationDialog({
  title = "Are you really sure?",
  description = "There is no going back, so if you're sure you want to delete this annotation score, type 'delete' below:",
  open,
  onClose,
  onConfirm,
}: {
  title?: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfirmationText("");
  }, [open]);

  const confirmed = confirmationText.toLowerCase() === "delete";
  const confirm = () => {
    if (!confirmed) {
      return;
    }
    onConfirm();
    onClose();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onClose}
      placement="center"
      initialFocusEl={() => inputRef.current}
    >
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            {title}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={4}>
            <Text>{description}</Text>
            <Input
              placeholder="Type 'delete' to confirm"
              data-testid="prompt-delete-confirm-input"
              value={confirmationText}

              onChange={(event) => {
                event.stopPropagation();
                setConfirmationText(event.target.value);
              }}
              ref={inputRef}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  confirm();
                }
              }}
            />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            colorPalette="red"
            data-testid="prompt-delete-confirm-button"
            onClick={(event) => {
              event.stopPropagation();
              confirm();
            }}
            disabled={!confirmed}
          >
            Delete
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
