import { Button, Text } from "@chakra-ui/react";
import { Dialog } from "~/components/ui/dialog";

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
  children?: React.ReactNode;
  /** Holds the confirm button closed until {@link children} is satisfied. */
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
