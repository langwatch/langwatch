import { Button, Grid, Heading, HStack, Separator } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { studioWorkflowSchema, type StudioWorkflow } from "@langwatch/workflow-contract";
import { ChevronLeft, File, Upload } from "react-feather";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { TEMPLATES } from "../../model/templates/templates.registry";

const MAX_WORKFLOW_FILE_SIZE = 5 * 1024 * 1024;

type WorkflowCreateStep = { step: "select" } | { step: "create"; template: StudioWorkflow };

export type WorkflowImportError = {
  title: string;
  description: string;
};

export type WorkflowTemplateCardProps = {
  name: string;
  icon: ReactNode;
  description: string | undefined;
  testId: string;
  dragging?: boolean;
  onClick: () => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
  children?: ReactNode;
};

export type WorkflowCreateDialogProps = {
  open: boolean;
  onClose: () => void;
  onImportError: (error: WorkflowImportError) => void;
  renderContentBoundary: (children: ReactNode) => ReactNode;
  renderForm: (input: { template: StudioWorkflow; onClose: () => void }) => ReactNode;
  renderTemplateCard: (props: WorkflowTemplateCardProps) => ReactNode;
};

type WorkflowImportFile = Pick<File, "size" | "text">;

export async function parseWorkflowImport(
  file: WorkflowImportFile,
): Promise<
  { success: true; workflow: StudioWorkflow } | { success: false; error: WorkflowImportError }
> {
  if (file.size > MAX_WORKFLOW_FILE_SIZE) {
    return {
      success: false,
      error: {
        title: "File too large",
        description: "File size must be less than 5MB",
      },
    };
  }

  try {
    const parsedJson: unknown = JSON.parse(await file.text());
    const result = studioWorkflowSchema.safeParse(parsedJson);

    if (!result.success) {
      const problems = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

      return {
        success: false,
        error: {
          title: "Invalid workflow file",
          description: problems,
        },
      };
    }

    return { success: true, workflow: result.data };
  } catch (readFailure) {
    return {
      success: false,
      error: {
        title: "Invalid workflow file",
        description: readFailure instanceof Error ? readFailure.message : String(readFailure),
      },
    };
  }
}

function useWorkflowFileDrop(onFileSelect: (file: File) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setIsDragging(false);

      const file = event.dataTransfer.files[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect],
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

export function WorkflowCreateDialog({
  open,
  onClose,
  onImportError,
  renderContentBoundary,
  renderForm,
  renderTemplateCard,
}: WorkflowCreateDialogProps) {
  const [step, setStep] = useState<WorkflowCreateStep>({ step: "select" });

  useEffect(() => {
    if (!open) {
      setStep({ step: "select" });
    }
  }, [open]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      const result = await parseWorkflowImport(file);

      if (!result.success) {
        onImportError(result.error);
        return;
      }

      setStep({ step: "create", template: result.workflow });
    },
    [onImportError],
  );

  const fileDrop = useWorkflowFileDrop((file) => {
    void handleFileUpload(file);
  });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && onClose()}
      size="xl"
      trapFocus={false}
      preventScroll={false}
    >
      <Dialog.Content bg="bg" paddingX={0}>
        {renderContentBoundary(
          <>
            <Dialog.Header>
              <HStack gap={2}>
                {step.step === "create" && (
                  <Button
                    variant="ghost"
                    data-variant="ghost"
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
                <Heading>Create new workflow</Heading>
              </HStack>
            </Dialog.Header>
            <Separator />
            <Dialog.CloseTrigger />
            {step.step === "select" ? (
              <Dialog.Body paddingY={6} marginBottom={6}>
                <Grid width="full" templateColumns="repeat(auto-fill, minmax(260px, 1fr))" gap={6}>
                  {Object.entries(TEMPLATES).map(([name, template]) => (
                    <Fragment key={name}>
                      {renderTemplateCard({
                        testId: `new-workflow-card-${name}`,
                        name: template.name,
                        icon:
                          name === "blank" ? (
                            <File color="var(--chakra-colors-fg-muted)" size={16} />
                          ) : (
                            template.icon
                          ),
                        description: template.description,
                        onClick: () => {
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
                          });
                        },
                      })}
                    </Fragment>
                  ))}
                  {renderTemplateCard({
                    testId: "new-workflow-card-import",
                    name: "From Export",
                    icon: <Upload color="var(--chakra-colors-fg-muted)" size={16} />,
                    description: "Import a workflow from an exported JSON file",
                    dragging: fileDrop.isDragging,
                    onClick: fileDrop.handleClick,
                    onDragOver: fileDrop.handleDragOver,
                    onDragLeave: fileDrop.handleDragLeave,
                    onDrop: fileDrop.handleDrop,
                    children: (
                      <input
                        ref={fileDrop.fileInputRef}
                        type="file"
                        accept=".json"
                        style={{ display: "none" }}
                        onChange={fileDrop.handleFileInputChange}
                      />
                    ),
                  })}
                </Grid>
              </Dialog.Body>
            ) : (
              renderForm({ template: step.template, onClose })
            )}
          </>,
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
