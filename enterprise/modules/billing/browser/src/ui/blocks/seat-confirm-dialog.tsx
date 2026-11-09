/**
 * The confirm a Growth seat change asks before the payment provider is touched.
 * @see specs/licensing/seat-buying.feature
 */
import { Dialog } from "@langwatch/design-system/dialog";
import { HStack, Separator, Text, VStack } from "@langwatch/design-system/primitives";

import type { SeatConfirm } from "../../model/seat-purchase.ts";

export function SeatConfirmDialog({
  confirm,
  onBack,
  onConfirm,
  isCommitting,
  disabledReason,
}: {
  /** Open while set. */
  confirm: SeatConfirm | undefined;
  onBack: () => void;
  onConfirm: () => void;
  isCommitting: boolean;
  disabledReason: string | undefined;
}) {
  return (
    <Dialog
      open={confirm !== undefined}
      onClose={onBack}
      title={confirm?.title ?? ""}
      busy={isCommitting}
      cancelLabel="Back"
      role="alertdialog"
      data-testid="seat-confirm-dialog"
      primaryAction={{
        label: confirm?.actionLabel ?? "Confirm",
        onClick: onConfirm,
        loading: isCommitting,
        disabledReason,
      }}
    >
      {confirm && (
        <VStack align="stretch" gap={4}>
          <VStack align="stretch" gap={3}>
            {confirm.lines.map((line, index) => (
              <VStack key={line.label} align="stretch" gap={3}>
                {index > 0 && <Separator />}
                <HStack justify="space-between" align="start" gap={4}>
                  <VStack align="start" gap={0.5}>
                    <Text fontWeight="medium">{line.label}</Text>
                    <Text textStyle="bodySm" color="fg.muted">
                      {line.detail}
                    </Text>
                  </VStack>
                  <VStack align="end" gap={0.5} flexShrink={0}>
                    <Text fontWeight="semibold" fontVariantNumeric="tabular-nums">
                      {line.value}
                    </Text>
                    {line.note && (
                      <Text textStyle="bodySm" color="fg.muted" fontVariantNumeric="tabular-nums">
                        {line.note}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              </VStack>
            ))}
          </VStack>
          {confirm.body && (
            <Text textStyle="bodySm" color="fg.muted" data-testid="seat-confirm-body">
              {confirm.body}
            </Text>
          )}
        </VStack>
      )}
    </Dialog>
  );
}
