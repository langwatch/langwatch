import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { type SlackConnection, unusedDeleteConfirmation } from "@langwatch/slack-contract";
import { Info } from "lucide-react";
import { useState } from "react";

import {
  inUseRefusalLabel,
  type SlackConnectionInUse,
} from "../../model/slack-connection-refusals.ts";

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
        <HStack key="in-use" gap={1.5} color="fg.muted" data-testid="slack-connection-in-use">
          <Info size={14} aria-hidden />
          <Text fontSize="sm">{inUseRefusalLabel(refusal)}</Text>
        </HStack>
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
