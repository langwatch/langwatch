/** Confirm archive by typing 'delete'. Replaces platform hook that returned
 * JSX (forbidden); dialog only now.
 */

import { Button, Input, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect, useRef, useState } from "react";

/** What the reader has to type before the destructive button unlocks. */
const CONFIRMATION_WORD = "delete";

export function DeleteDatasetDialog({
  datasetName,
  open,
  onClose,
  onConfirm,
}: {
  /** Named in the prompt so the reader can see which dataset they are on. */
  datasetName: string | undefined;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTyped("");
  }, [open]);

  const confirmed = typed.trim().toLowerCase() === CONFIRMATION_WORD;
  const confirm = () => {
    if (!confirmed) {
      inputRef.current?.focus();
      return;
    }
    onConfirm();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(details) => !details.open && onClose()}>
      <Dialog.Content bg="bg" maxWidth="480px">
        <Dialog.Header>
          <Dialog.Title>Are you really sure?</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Text fontSize="sm" color="fg.muted">
              Deleting &quot;{datasetName ?? "this dataset"}&quot; cannot be undone. Type &apos;
              {CONFIRMATION_WORD}&apos; below to confirm:
            </Text>
            <Input
              ref={inputRef}
              
              value={typed}
              aria-label={`Type ${CONFIRMATION_WORD} to confirm`}
              data-testid="delete-dataset-confirmation"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirm();
              }}
            />
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            disabled={!confirmed}
            data-testid="delete-dataset-confirm"
            onClick={confirm}
          >
            Delete
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
