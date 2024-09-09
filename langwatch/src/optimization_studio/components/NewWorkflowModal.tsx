import {
  Divider,
  Heading,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
} from "@chakra-ui/react";
import { WorkflowCard, WorkflowCardBase } from "./workflow/WorkflowCard";
import { File } from "react-feather";

export function NewWorkflowModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl">
      <ModalOverlay />
      <ModalContent paddingX={0} paddingBottom={6}>
        <ModalHeader>Create new workflow</ModalHeader>
        <Divider />
        <ModalCloseButton />
        <ModalBody background="gray.200" paddingY={6}>
          <WorkflowCard
            name="Blank template"
            icon={<File color="#666" size={16} />}
            description="Start a new workflow from scratch"
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
