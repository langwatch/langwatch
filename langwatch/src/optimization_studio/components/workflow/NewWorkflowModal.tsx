import { useEffect, useState } from "react";
import { Button, Separator, Grid, HStack, Text } from "@chakra-ui/react";
import { Dialog } from "../../../components/ui/dialog";
import { WorkflowCard } from "./WorkflowCard";
import { ChevronLeft, File } from "react-feather";
import { NewWorkflowForm } from "./NewWorkflowForm";
import type { Workflow } from "../../types/dsl";
import { TEMPLATES } from "../../templates/registry";

type Step = { step: "select" } | { step: "create"; template: Workflow };

export const NewWorkflowModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const [step, setStep] = useState<Step>({ step: "select" });

  useEffect(() => {
    if (!open) {
      setStep({ step: "select" });
    }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onClose}>
      <Dialog.Backdrop />
      <Dialog.Content width="800px" paddingX={0}>
        <Dialog.Header>
          <HStack gap={2}>
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
        </Dialog.Header>
        <Separator />
        <Dialog.CloseTrigger />
        {step.step === "select" ? (
          <Dialog.Body background="gray.200" paddingY={6} marginBottom={6}>
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
          </Dialog.Body>
        ) : (
          <NewWorkflowForm onClose={onClose} template={step.template} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
};
