import { Button, Text, VStack } from "@chakra-ui/react";
import type { AgentCopy } from "@langwatch/agent-contract";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";

/**
 * Pushing one agent's configuration out to the replicas made from it.
 *
 * A family-local copy of
 * `platform/app/src/components/ui/PushToCopiesDialog.tsx`, narrowed to agents.
 * The platform component keeps its generic copy item and its evaluator and
 * prompt wrappers, and dies with them.
 *
 * WHAT DID NOT TRAVEL is the toast and `HandledErrorAlert`. The words a customer
 * reads for a failure come from the application's code-keyed presentation
 * registry, which a feature-web package may not reach; the caller resolves the
 * line through the host and hands it down as `errorMessage`, and the success
 * notice is the screen's to raise.
 */

export type AgentPushDialogProps = {
  open: boolean;
  agentName: string;
  copies: readonly AgentCopy[];
  isLoading: boolean;
  /** Already resolved to customer-facing copy by the host; absent when fine. */
  errorMessage?: string;
  selectedCopyIds: ReadonlySet<string>;
  isPushing: boolean;
  onClose: () => void;
  onToggleCopy: (copyId: string) => void;
  onPush: () => Promise<void>;
};

export function AgentPushDialog({
  open,
  agentName,
  copies,
  isLoading,
  errorMessage,
  selectedCopyIds,
  isPushing,
  onClose,
  onToggleCopy,
  onPush,
}: AgentPushDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(event) => !event.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            <Text fontSize="sm" color="fg.muted">
              {`Select which replicas to push "${agentName}" to:`}
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
                      <Text fontWeight="medium">{copy.name}</Text>
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
