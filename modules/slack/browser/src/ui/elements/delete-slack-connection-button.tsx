import { Button, Text, VStack } from "@chakra-ui/react";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import {
  inUseRefusalLabel,
  type SlackConnection,
  type SlackConnectionInUse,
  unusedDeleteConfirmation,
} from "@langwatch/slack-browser-kit";
import { useState } from "react";

/**
 * A connection listed as unused confirms before anything is sent; one listed as in use sends
 * straight away, since the server refuses it and nothing is lost. A refusal names the
 * automations that claim the connection, and the connection is kept (§3, no forced delete).
 */
export function DeleteSlackConnectionButton({
  connection,
  refusals,
  isPending,
  onDelete,
}: {
  connection: SlackConnection;
  refusals: SlackConnectionInUse[];
  isPending: boolean;
  onDelete: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmation = unusedDeleteConfirmation({ name: connection.name });

  return (
    <VStack align="end" gap={1}>
      <Button
        variant="outline"
        colorPalette="red"
        loading={isPending && !isConfirming}
        onClick={() => {
          if (connection.dependentAutomations > 0) onDelete();
          else setIsConfirming(true);
        }}
      >
        Delete
      </Button>
      {refusals.map((refusal) => (
        <Text key="in-use" fontSize="sm" color="fg.error" data-testid="slack-connection-in-use">
          {inUseRefusalLabel(refusal)}
        </Text>
      ))}
      <ConfirmDialog
        open={isConfirming && refusals.length === 0}
        onOpenChange={(open) => {
          if (!open) setIsConfirming(false);
        }}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        tone="danger"
        loading={isPending}
        onConfirm={onDelete}
      />
    </VStack>
  );
}
