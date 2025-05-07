import { useEffect, useState, useRef, useCallback } from "react";
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
import { workflowJsonSchema } from "../../types/dsl";

/** Maximum allowed file size for workflow imports (5MB) */
const MAX_WORKFLOW_FILE_SIZE = 5 * 1024 * 1024;

type Step = { step: "select" } | { step: "create"; template: Workflow };

/**
 * Hook for handling file drag and drop functionality
 * @param onFileSelect Callback when a file is selected
 * @returns Object containing drag state and event handlers
 */
function useFileDrop(onFileSelect: (file: File) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  return {
    isDragging,
    fileInputRef,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleClick,
    handleFileInputChange,
  };
}

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

  const handleFileUpload = useCallback(
    (file: File) => {
      if (file.size > MAX_WORKFLOW_FILE_SIZE) {
        toaster.create({
          title: "File too large",
          description: "File size must be less than 5MB",
          type: "error",
          meta: { closable: true },
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const jsonContent = JSON.parse(content);
          const result = workflowJsonSchema.safeParse(jsonContent);

          if (!result.success) {
            const errorMessage = result.error.errors
              .map((err) => `${err.path.join(".")}: ${err.message}`)
              .join("\n");
            throw new Error(errorMessage);
          }

          setStep({ step: "create", template: result.data as Workflow });
        } catch (error) {
          toaster.create({
            title: "Invalid workflow file",
            description:
              error instanceof Error ? error.message : "Unknown error occurred",
            type: "error",
            meta: { closable: true },
          });
        }
      };
      reader.readAsText(file);
    },
    [setStep]
  );

  const {
    isDragging,
    fileInputRef,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleClick,
    handleFileInputChange,
  } = useFileDrop(handleFileUpload);

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
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
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
                  onChange={handleFileInputChange}
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
