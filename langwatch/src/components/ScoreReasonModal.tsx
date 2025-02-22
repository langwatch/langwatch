import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";

export function ScoreReasonModal({
  reason: initialReason,
  isOpen,
  onClose,
  onConfirm,
}: {
  reason: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [scoreReason, setScoreReason] = useState(initialReason);

  useEffect(() => {
    setScoreReason(initialReason);
  }, [initialReason, isOpen]);

  return (
    <>
      <Modal
        blockScrollOnMount={false}
        isOpen={isOpen}
        onClose={onClose}
        isCentered
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader fontSize="md" fontWeight="500">
            Why did you select this option?
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              placeholder="Explain your reasoning"
              value={scoreReason}
              onChange={(e) => setScoreReason(e.target.value)}
            />
          </ModalBody>

          <ModalFooter fontWeight="500">
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
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
