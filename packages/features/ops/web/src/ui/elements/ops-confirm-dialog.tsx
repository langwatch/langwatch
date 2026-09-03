/**
 * The two-step confirm every destructive Ops action goes through.
 *
 * Moved from `platform/app/src/components/ops/shared/ConfirmDialog.tsx` with one
 * line changed: the dialog primitive is the Design System's rather than the
 * application's. Nine call sites across the queue, payload-store and scheduler
 * surfaces render it, and none of them changed.
 *
 * NOT the same component as `@langwatch/design-system/confirm-dialog`, which the
 * gateway and governance families adopted: this one takes an arbitrary child
 * under the description, which is what the typed-confirmation inputs on the
 * destructive queue actions render into.
 */

import { Button, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Dialog } from "./ops-dialog";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  isLoading,
  children,
  confirmDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  isLoading: boolean;
  /**
   * Optional extra input rendered under the description. Used where confirming
   * should take deliberate effort rather than one click, e.g. typing the name
   * of what is about to be destroyed.
   */
  children?: ReactNode;
  /**
   * Disables the confirm button while true. The parent owns the condition —
   * e.g. a typed-confirmation input that only enables Confirm once the required
   * word is present — this component just reflects it.
   */
  confirmDisabled?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text textStyle="sm">{description}</Text>
          {children}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            size="sm"
            onClick={onConfirm}
            loading={isLoading}
            disabled={confirmDisabled}
          >
            Confirm
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
