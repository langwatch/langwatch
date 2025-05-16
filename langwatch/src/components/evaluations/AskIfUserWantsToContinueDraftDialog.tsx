import { HStack, Text, Button } from "@chakra-ui/react";
import { type DialogRootProps, Dialog } from "~/components/ui/dialog";

interface AskIfUserWantsToContinueDraftDialogProps
  extends Omit<DialogRootProps, "children"> {
  onStartNew: () => void;
  onContinueDraft: () => void;
}

export function AskIfUserWantsToContinueDraftDialog({
  onStartNew,
  onContinueDraft,
  ...dialogProps
}: AskIfUserWantsToContinueDraftDialogProps) {
  return (
    <Dialog.Root {...dialogProps}>
      <Dialog.Backdrop />
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Continue with Draft?</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <Text>
            You have an unfinished draft evaluation. Would you like to continue
            with it or start a new one?
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={2}>
            <Button variant="outline" onClick={onStartNew}>
              Start New
            </Button>
            <Button colorPalette="orange" onClick={onContinueDraft}>
              Continue Draft
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
