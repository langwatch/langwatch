import { Button, Text } from "@chakra-ui/react";

import { Dialog } from "../ui/dialog";

/**
 * Asked when a close would throw away unsaved scenario work.
 *
 * Red rather than the orange the archive dialog uses: archiving is reversible
 * and this is not — a new scenario has no record to come back to, and an edited
 * one has no draft.
 *
 * @see specs/scenarios/scenario-editor-discard-guard.feature
 */
export function ScenarioDiscardChangesDialog({
  open,
  isEditing,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean;
  /** Editing a saved scenario — only the changes are lost, not the scenario. */
  isEditing: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => {
        if (!nextOpen) onKeepEditing();
      }}
      placement="center"
      role="alertdialog"
    >
      <Dialog.Content bg="bg" maxWidth="440px">
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            {isEditing ? "Discard your changes?" : "Discard this scenario?"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text color="fg.muted" fontSize="sm">
            {isEditing
              ? "Your edits have not been saved. Closing now loses them."
              : "This scenario has not been saved yet. Closing now loses it."}
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" marginRight={3} onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button colorPalette="red" onClick={onDiscard}>
            Discard
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
