import { Button, Text, VStack } from "@chakra-ui/react";
import type { AgentCopy } from "@langwatch/agent-contract";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";

/** The caller resolves failures and reports the outcome after pushing replicas. */

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

export function AgentPushDialog(props: AgentPushDialogProps) {
  const { open, agentName, isLoading, selectedCopyIds, isPushing, onClose, onPush } = props;
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
            <ReplicaSelection {...props} />
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

function ReplicaSelection({
  copies,
  isLoading,
  errorMessage,
  selectedCopyIds,
  onToggleCopy,
}: AgentPushDialogProps) {
  if (isLoading) return <Text>Loading replicas...</Text>;
  if (errorMessage)
    return (
      <Text role="alert" color="red.fg">
        {errorMessage}
      </Text>
    );
  if (copies.length === 0) return <Text color="fg.muted">No replicas found.</Text>;

  return (
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
  );
}
