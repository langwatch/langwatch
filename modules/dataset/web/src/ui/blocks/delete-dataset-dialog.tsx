/**
 * Confirms archiving a dataset, by typing the word.
 *
 * A family-local copy of `platform/app/src/components/ui/delete-confirmation-dialog`,
 * which the annotation-score settings still render. Deletes-only forbids
 * repointing it, so the platform copy stays for that surface and this one
 * travels with the datasets list.
 *
 * `useDeleteDatasetConfirmation` — the platform hook this replaces — RETURNED A
 * COMPONENT, which the house rules forbid: a hook returns state and callbacks,
 * and the consumer renders. The dataset being deleted is the list screen's own
 * state now, and this is only the dialog.
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
              autoFocus
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
