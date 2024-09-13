import { useEffect, useState } from "react";
import {
  Button,
  Divider,
  Grid,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
} from "@chakra-ui/react";
import { WorkflowCard } from "./WorkflowCard";
import { ChevronLeft, File } from "react-feather";
import { NewWorkflowForm } from "./NewWorkflowForm";
import type { Workflow } from "../../types/dsl";
import { TEMPLATES } from "../../templates/registry";

type Step = { step: "select" } | { step: "create"; template: Workflow };

export const NewWorkflowModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [step, setStep] = useState<Step>({ step: "select" });

  useEffect(() => {
    if (!isOpen) {
      setStep({ step: "select" });
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="6xl">
      <ModalOverlay />
      <ModalContent paddingX={0}>
        <ModalHeader>
          <HStack>
            {step.step === "create" && (
              <Button
                variant="ghost"
                onClick={() => setStep({ step: "select" })}
                size="sm"
                paddingX={0}
                marginLeft={-2}
                marginBottom={-2}
                marginTop={-2}
              >
                <ChevronLeft />
              </Button>
            )}
            <Text>Create new workflow</Text>
          </HStack>
        </ModalHeader>
        <Divider />
        <ModalCloseButton />
        {step.step === "select" ? (
          <ModalBody background="gray.200" paddingY={6} marginBottom={6}>
            <Grid
              width="full"
              templateColumns="repeat(auto-fill, minmax(260px, 1fr))"
              gap={6}
            >
              {Object.entries(TEMPLATES).map(([name, template]) => (
                <WorkflowCard
                  key={name}
                  name={template.name}
                  icon={
                    name === "blank" ? (
                      <File color="#666" size={16} />
                    ) : (
                      template.icon
                    )
                  }
                  description={template.description}
                  onClick={() =>
                    setStep({
                      step: "create",
                      template:
                        name === "blank"
                          ? {
                              ...template,
                              name: "New Workflow",
                              icon: "🧩",
                              description: "",
                            }
                          : template,
                    })
                  }
                />
              ))}
            </Grid>
          </ModalBody>
        ) : (
          <NewWorkflowForm onClose={onClose} template={step.template} />
        )}
      </ModalContent>
    </Modal>
  );
};
