import { Button, Input, Dialog } from "@chakra-ui/react";
import { useEffect, useState } from "react";

export function ScoreReasonModal({
  reason: initialReason,
  open,
  onClose,
  onConfirm,
}: {
  reason: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [scoreReason, setScoreReason] = useState(initialReason);

  useEffect(() => {
    setScoreReason(initialReason);
  }, [initialReason, open]);

  return (
    <Dialog.Root open={open} onOpenChange={onClose} placement="center">
      <Dialog.Backdrop />
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Why did you select this option?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Input
            placeholder="Explain your reasoning"
            value={scoreReason}
            onChange={(e) => setScoreReason(e.target.value)}
          />
        </Dialog.Body>
        <Dialog.Footer fontWeight="500">
          <Button variant="outline" mr={3} onClick={onClose}>
            Leave Blank
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => {
              onConfirm(scoreReason);
              onClose();
            }}
          >
            Add
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
