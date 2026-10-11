import type { AgentCopy } from "@langwatch/agent-contract";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { useState } from "react";

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
  const { open, agentName, copies, isLoading, selectedCopyIds, isPushing, onClose, onPush } = props;
  const [attempted, setAttempted] = useState(false);
  const nothingSelected = selectedCopyIds.size === 0;
  let unavailable: string | undefined;
  if (isLoading) unavailable = "Replicas are still loading";
  else if (copies.length === 0) unavailable = "There are no replicas to push to";
  const push = () => {
    if (isPushing) return;
    if (nothingSelected) return setAttempted(true);
    void onPush();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Push to Replicas"
      busy={isPushing}
      primaryAction={{
        label: `Push to ${selectedCopyIds.size} replica${selectedCopyIds.size === 1 ? "" : "s"}`,
        onClick: push,
        loading: isPushing,
        disabledReason: unavailable,
      }}
    >
      <VStack gap={4} align="start">
        <Text fontSize="sm" color="fg.muted">
          {`Select which replicas to push "${agentName}" to:`}
        </Text>
        <ReplicaSelection {...props} />
        {attempted && nothingSelected && copies.length > 0 && (
          <Text role="alert" color="red.fg" textStyle="sm">
            Select at least one replica to push to.
          </Text>
        )}
      </VStack>
    </Dialog>
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
  if (copies.length === 0) {
    return (
      <NoDataInfoBlock
        size="line"
        title="No replicas found. Use Replicate to another project on this agent's menu to create one."
      />
    );
  }

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
