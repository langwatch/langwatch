/**
 * Creating a workflow, from a template or from an imported file.
 */

import { EmojiPicker } from "@langwatch/design-system/emoji-picker";
import {
  Button,
  Field,
  HStack,
  Input,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { studioWorkflowWireSchema, type StudioWorkflow } from "@langwatch/workflow-contract";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";

import { workflowApi } from "../../behavior/workflow-api.ts";
import { getRandomWorkflowIcon } from "../../model/random-workflow-icon.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";
import {
  WorkflowCreateDialog as WorkflowCreateDialogView,
  type WorkflowTemplateCardProps,
} from "../elements/workflow-create-dialog.tsx";
import { WorkflowErrorBoundary } from "../elements/workflow-error-boundary.tsx";
import { WorkflowListCard } from "./workflow-list-card.tsx";

type WorkflowCreationFormData = {
  name: string;
  icon: string;
  description: string;
};

export function WorkflowCreateDialogHost({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const host = useWorkflowHost();

  return (
    <WorkflowCreateDialogView
      open={open}
      onClose={onClose}
      onImportError={(error) =>
        host.failed({
          error: new Error(error.description),
          fallbackTitle: error.title,
          description: error.description,
        })
      }
      renderContentBoundary={(children) => (
        <WorkflowErrorBoundary>{children}</WorkflowErrorBoundary>
      )}
      renderForm={({ template, formId, footerSlot }) => (
        <NewWorkflowForm
          template={template}
          onClose={onClose}
          formId={formId}
          footerSlot={footerSlot}
        />
      )}
      renderTemplateCard={(props) => <WorkflowTemplateCard {...props} />}
    />
  );
}

function WorkflowTemplateCard({ testId, dragging, children, ...props }: WorkflowTemplateCardProps) {
  return (
    <WorkflowListCard
      {...props}
      data-testid={testId}
      {...(dragging ? { borderStyle: "dashed", borderColor: "blue.fg" } : {})}
    >
      {children}
    </WorkflowListCard>
  );
}

function NewWorkflowForm({
  template,
  onClose,
  formId,
  footerSlot,
}: {
  template: StudioWorkflow;
  onClose: () => void;
  formId: string;
  footerSlot: HTMLElement | null;
}) {
  const host = useWorkflowHost();
  const { projectId, projectSlug } = host.scope();
  const [defaultIcon] = useState(
    template.icon && template.icon !== "🧩" ? template.icon : getRandomWorkflowIcon(),
  );

  const form = useForm<WorkflowCreationFormData>({
    defaultValues: {
      name: template.name ?? "New Workflow",
      icon: defaultIcon,
      description: template.description ?? "",
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;
  const createWorkflowMutation = workflowApi.workflow.create.useMutation();
  const icon = watch("icon");

  const onSubmit = (data: WorkflowCreationFormData) => {
    if (!projectId) return;

    const newWorkflow = studioWorkflowWireSchema.parse({
      ...template,
      version: "1",
      name: data.name,
      description: data.description,
      icon: data.icon ?? defaultIcon,
    });

    createWorkflowMutation.mutate(
      {
        projectId,
        dsl: newWorkflow,
        commitMessage: "Workflow creation",
      },
      {
        onSuccess: (createdWorkflow) => {
          onClose();
          host.navigate(`/${projectSlug ?? ""}/studio/${createdWorkflow.workflow.id}`);
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create workflow" }),
      },
    );
  };

  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.value = template.name ?? "New Workflow";
      nameRef.current.focus();
    }
    setValue("name", template.name ?? "New Workflow");
    setValue("icon", defaultIcon);
    setValue("description", template.description ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)}>
      <VStack gap={4} align="stretch">
        <Field.Root invalid={!!errors.name || !!errors.icon}>
          <Field.Label>Name and icon</Field.Label>
          <HStack>
            <EmojiPicker value={icon} onChange={(emoji) => setValue("icon", emoji)} />
            <Input
              {...register("name", { required: "Name is required" })}
              ref={nameRef}
              data-testid="workflow-create-name"
              onChange={(event) => {
                setValue("name", event.target.value);
              }}
            />
          </HStack>
          <Field.ErrorText>{errors.name?.message ?? errors.icon?.message}</Field.ErrorText>
        </Field.Root>
        <Field.Root invalid={!!errors.description}>
          <Field.Label>Description</Field.Label>
          <Textarea {...register("description")} />
          <Field.ErrorText>{errors.description?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>
      {footerSlot &&
        createPortal(
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              colorPalette="orange"
              variant="solid"
              data-testid="workflow-create-submit"
              loading={createWorkflowMutation.isPending}
            >
              Create workflow
            </Button>
          </>,
          footerSlot,
        )}
    </form>
  );
}
