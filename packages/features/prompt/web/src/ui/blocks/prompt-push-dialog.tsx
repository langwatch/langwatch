/**
 * Pushing one prompt's latest version out to the replicas made from it.
 *
 * A family-local copy of `platform/app/src/components/ui/PushToCopiesDialog.tsx`
 * (two other callers, un-repointable), narrowed to prompts — the agents
 * family's `agent-push-dialog`, second use.
 *
 * WHAT DID NOT TRAVEL is the toast and `HandledErrorAlert`. The words a
 * customer reads for a failure come from the application's code-keyed
 * presentation registry, which a feature-web package may not reach; the caller
 * resolves the line through the host and hands it down as `errorMessage`, and
 * the success notice is the screen's to raise.
 */

import { Button, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";

/** One replica the picker lists. */
export type PromptCopyItem = {
  id: string;
  fullPath: string;
  handle: string | null;
};

export type PromptPushDialogProps = {
  open: boolean;
  promptName: string;
  copies: readonly PromptCopyItem[];
  isLoading: boolean;
  /** Already resolved to customer-facing copy by the host; absent when fine. */
  errorMessage?: string;
  selectedCopyIds: ReadonlySet<string>;
  isPushing: boolean;
  onClose: () => void;
  onToggleCopy: (copyId: string) => void;
  onPush: () => Promise<void>;
};

export function PromptPushDialog({
  open,
  promptName,
  copies,
  isLoading,
  errorMessage,
  selectedCopyIds,
  isPushing,
  onClose,
  onToggleCopy,
  onPush,
}: PromptPushDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(event) => !event.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            <Text fontSize="sm" color="fg.muted">
              {`Select which replicas to push the latest version of "${promptName}" to:`}
            </Text>
            {isLoading ? (
              <Text>Loading replicas...</Text>
            ) : errorMessage ? (
              <Text role="alert" color="red.fg">
                {errorMessage}
              </Text>
            ) : copies.length === 0 ? (
              <Text color="fg.muted">No replicas found.</Text>
            ) : (
              <VStack gap={2} align="start" width="full">
                {copies.map((copy) => (
                  <Checkbox
                    key={copy.id}
                    checked={selectedCopyIds.has(copy.id)}
                    onChange={() => onToggleCopy(copy.id)}
                  >
                    <VStack align="start" gap={0}>
                      <Text fontWeight="medium">{copy.handle ?? copy.id}</Text>
                      <Text fontSize="sm" color="fg.muted">
                        {copy.fullPath}
                      </Text>
                    </VStack>
                  </Checkbox>
                ))}
              </VStack>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void onPush()}
            loading={isPushing}
            disabled={selectedCopyIds.size === 0 || isLoading}
          >
            Push to {selectedCopyIds.size} replica
            {selectedCopyIds.size === 1 ? "" : "s"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
