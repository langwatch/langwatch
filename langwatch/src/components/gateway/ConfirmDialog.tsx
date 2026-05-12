import { Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";

import { Dialog } from "~/components/ui/dialog";

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

/**
 * Reusable confirmation modal for destructive gateway actions
 * (revoke VK, archive budget, rotate secret, disable provider binding).
 * Replaces `window.confirm` which is a11y-hostile and not themable.
 */
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
  const palette = tone === "danger" ? "red" : "orange";
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
    >
      <Dialog.Content maxWidth="480px">
        <Dialog.Header>
          <HStack gap={3} align="start">
            <AlertTriangle
              size={20}
              color={tone === "danger" ? "#E53E3E" : "#ED8936"}
            />
            <VStack align="start" gap={0}>
              <Dialog.Title>{title}</Dialog.Title>
            </VStack>
          </HStack>
        </Dialog.Header>
        <Dialog.Body>
          <Text fontSize="sm" color="fg.muted">
            {message}
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              colorPalette={palette}
              onClick={onConfirm}
              loading={loading}
            >
              {confirmLabel}
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
