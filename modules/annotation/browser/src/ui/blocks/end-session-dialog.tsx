/** The question asked before a sitting ends with nothing handed over to a dataset. */

import { Button } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";

/** What the reviewer is asked before the session ends with no dataset. */
export const END_SESSION_QUESTION =
  "Are you sure you want to end this annotation session without adding to a dataset?";

export function EndSessionDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      placement="center"
      onOpenChange={({ open: nextOpen }) => {
        if (!nextOpen) onCancel();
      }}
    >
      <Dialog.Content bg="bg" maxWidth="480px">
        <Dialog.Header>
          <Dialog.Title fontSize="sm" fontWeight="500">
            {END_SESSION_QUESTION}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button colorPalette="blue" onClick={onConfirm}>
            Confirm
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
