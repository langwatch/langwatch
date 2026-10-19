import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Grid, HStack } from "@langwatch/design-system/primitives";
import { studioWorkflowSchema, type StudioWorkflow } from "@langwatch/workflow-contract";
import { CircleCheck, File, Upload } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { TEMPLATES } from "../../model/templates/templates.registry.ts";

const MAX_WORKFLOW_FILE_SIZE = 5 * 1024 * 1024;
const CREATE_FORM_ID = "workflow-create-form";

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
  /** The form lives in the body; its Cancel and submit are portalled into `footerSlot`. */
  renderForm: (input: {
    template: StudioWorkflow;
    onClose: () => void;
    formId: string;
    footerSlot: HTMLElement | null;
  }) => ReactNode;
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

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

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
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setStep({ step: "select" });
    }
  }, [open]);

  const handleFileUpload = async (file: File) => {
    const result = await parseWorkflowImport(file);

    if (!result.success) {
      onImportError(result.error);
      return;
    }

    setStep({ step: "create", template: result.workflow });
  };

  const fileDrop = useWorkflowFileDrop((file) => {
    void handleFileUpload(file);
  });

  const selectContent = (
    <Box paddingX={6} paddingTop={6} paddingBottom={12}>
      <Grid width="full" templateColumns="repeat(auto-fill, minmax(260px, 1fr))" gap={6}>
        {Object.entries(TEMPLATES).map(([name, template]) => (
          <Fragment key={name}>
            {renderTemplateCard({
              testId: `new-workflow-card-${name}`,
              name: template.name,
              icon: <TemplateIcon name={name} />,
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
          name: "From export",
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
    </Box>
  );

  const frame = {
    open,
    onClose,
    title: "Create new workflow",
    size: "detail",
    body: "flush",
    // The emoji picker and the file dialog live outside the frame.
    trapFocus: false,
    preventScroll: false,
    children: renderContentBoundary(
      step.step === "select" ? (
        selectContent
      ) : (
        <Box paddingX={6} paddingY={4}>
          {renderForm({ template: step.template, onClose, formId: CREATE_FORM_ID, footerSlot })}
        </Box>
      ),
    ),
  } as const;

  if (step.step === "select") return <Dialog {...frame} cancelLabel={null} />;
  return (
    <Dialog
      {...frame}
      onBack={() => setStep({ step: "select" })}
      footerContent={<HStack ref={setFooterSlot} width="full" justify="flex-end" gap={2} />}
    />
  );
}

function TemplateIcon({ name }: { name: string }) {
  const Icon = name === "blank" ? File : CircleCheck;
  return <Icon color="var(--chakra-colors-fg-muted)" size={16} />;
}
