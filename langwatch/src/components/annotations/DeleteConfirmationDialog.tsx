import { Button, Input, VStack, Text, Code } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../ui/dialog";

/**
 * Renders a dialog that prompts the user to confirm deletion by typing "delete".
 *
 * The dialog resets its input field each time it is opened. If the confirmation text matches "delete" (case-insensitive), pressing "Enter" or clicking the "Delete" button triggers the deletion process by calling the onConfirm callback followed by onClose. The "Cancel" button also calls onClose to dismiss the dialog.
 *
 * @param open - Whether the dialog is visible.
 * @param onClose - Callback invoked when the dialog is closed.
 * @param onConfirm - Callback invoked when the deletion is confirmed.
 */
export function DeleteConfirmationDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfirmationText("");
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onClose}
      placement="center"
      initialFocusEl={() => inputRef.current}
    >
      <Dialog.Backdrop />
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Are you really sure?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={4}>
            <Text>
              There is no going back, so if you're sure you want to delete this
              annotation score, type <Code>delete</Code> below:
            </Text>
            <Input
              placeholder="Type 'delete' to confirm"
              value={confirmationText}
              autoFocus
              onChange={(e) => setConfirmationText(e.target.value)}
              ref={inputRef}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (confirmationText.toLowerCase() === "delete") {
                    onConfirm();
                    onClose();
                  }
                }
              }}
            />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" mr={3} onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            onClick={() => {
              if (confirmationText.toLowerCase() === "delete") {
                onConfirm();
                onClose();
              }
            }}
            disabled={confirmationText.toLowerCase() !== "delete"}
          >
            Delete
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
} 
