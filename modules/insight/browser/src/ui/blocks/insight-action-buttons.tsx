/**
 * The actions Langy proposed with an insight: each a button and, beside it, the exact prompt
 * the click sends, so nothing is sent that the reader has not read. The first is the primary.
 */

import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { InsightAction } from "@langwatch/insight-contract";

export function InsightActionButtons({
  actions,
  disabledReason,
  pendingActionId,
  onRun,
}: {
  actions: readonly InsightAction[];
  /** Set when the reader may not send Langy a message: the buttons are disabled and say why. */
  disabledReason: string | null;
  pendingActionId: string | null;
  onRun: (actionId: string) => void;
}) {
  if (actions.length === 0) return null;
  const isBusy = pendingActionId !== null;

  return (
    <VStack align="stretch" gap={2} marginTop={4} data-testid="insight-actions">
      {actions.map((action, position) => (
        <HStack key={action.id} align="flex-start" gap={3}>
          <Button
            size="xs"
            flexShrink={0}
            variant={position === 0 ? "solid" : "outline"}
            disabled={disabledReason !== null || isBusy}
            loading={pendingActionId === action.id}
            title={disabledReason ?? void 0}
            onClick={() => onRun(action.id)}
          >
            {action.label}
          </Button>
          <Text textStyle="caption" color="fg.muted" whiteSpace="pre-wrap" minWidth={0}>
            {action.prompt}
          </Text>
        </HStack>
      ))}
      {disabledReason && (
        <Text textStyle="micro" color="fg.subtle">
          {disabledReason}
        </Text>
      )}
    </VStack>
  );
}
