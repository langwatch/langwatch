import { useEffect, useState, useRef } from "react";
import {
  Button,
  Separator,
  Grid,
  HStack,
  Text,
  Box,
  VStack,
} from "@chakra-ui/react";
import { Dialog } from "../../../components/ui/dialog";
import { WorkflowCard } from "./WorkflowCard";
import { ChevronLeft, File, Upload } from "react-feather";
import { NewWorkflowForm } from "./NewWorkflowForm";
import type { Workflow } from "../../types/dsl";
import { TEMPLATES } from "../../templates/registry";
import { toaster } from "../../../components/ui/toaster";

type Step = { step: "select" } | { step: "create"; template: Workflow };

export const NewWorkflowModal = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const [step, setStep] = useState<Step>({ step: "select" });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setStep({ step: "select" });
    }
  }, [open]);

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();

    if (file.size > 5 * 1024 * 1024) {
      toaster.create({
        title: "File too large",
        description: "Please upload a file smaller than 5MB.",
        type: "error",
        placement: "top-end",
        meta: { closable: true },
      });
      return;
    }
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const workflowTemplate = JSON.parse(content) as Workflow;
        setStep({ step: "create", template: workflowTemplate });
      } catch (error) {
        toaster.create({
          title: "Invalid workflow file",
          description:
            "The file you uploaded is not a valid workflow JSON file.",
          type: "error",
          placement: "top-end",
          meta: { closable: true },
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && onClose()}
      size="6xl"
    >
      <Dialog.Backdrop />
      <Dialog.Content paddingX={0}>
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
                  data-testid={`new-workflow-card-${name}`}
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
              <Box
                as="div"
                borderWidth="2px"
                borderRadius="md"
                borderStyle="dashed"
                cursor="pointer"
                backgroundColor="white"
                data-testid="new-workflow-card-import"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileUpload(file);
                }}
                borderColor={isDragging ? "blue.500" : "gray.200"}
                transition="all 0.2s"
                _hover={{ borderColor: "blue.300" }}
                p={4}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <VStack align="center" gap={2} paddingY={4}>
                  <Box p={2}>
                    <Upload color="#666" size={16} />
                  </Box>
                  <Text fontWeight="bold">From Export</Text>
                  <Text fontSize="sm" color="gray.600" textAlign="center">
                    Import a workflow from an exported JSON file
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    Drag and drop or click to select
                  </Text>
                </VStack>
              </Box>
            </Grid>
          </Dialog.Body>
        ) : (
          <NewWorkflowForm onClose={onClose} template={step.template} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
};
