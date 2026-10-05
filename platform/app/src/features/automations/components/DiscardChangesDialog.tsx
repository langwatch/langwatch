import { Button, HStack, Text } from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";
import type { DiscardTarget } from "../state/useDiscardGuard";

/** Asks before unsaved changes are thrown away by closing the drawer or starting a new automation. */
export function DiscardChangesDialog({
  pendingTarget,
  noun,
  onKeepEditing,
  onDiscard,
}: {
  pendingTarget: DiscardTarget | null;
  noun: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog.Root
      open={pendingTarget !== null}
      onOpenChange={({ open }) => {
        if (!open) onKeepEditing();
      }}
      size="sm"
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Discard unsaved changes?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text color="fg.muted" textStyle="sm">
            This {noun} has changes you haven't saved yet.{" "}
            {pendingTarget === "createNew"
              ? "Start a new automation and discard them?"
              : "Close the drawer and discard them?"}
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2}>
            <Button variant="ghost" size="sm" onClick={onKeepEditing}>
              Keep editing
            </Button>
            <Button colorPalette="red" size="sm" onClick={onDiscard}>
              Discard
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
