import { Button, Text } from "@chakra-ui/react";

import { Dialog } from "./dialog.tsx";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "warning";
  loading?: boolean;
  onConfirm: () => void;
};

/** The one confirmation dialog for an action that needs a second thought. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(details) => onOpenChange(details.open)}>
      <Dialog.Content maxWidth="480px">
        <Dialog.CloseTrigger disabled={loading} />
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" color="fg.muted">
            {message}
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            colorPalette={tone === "danger" ? "red" : "orange"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
