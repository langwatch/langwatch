import {
  Button,
  type ButtonProps,
  Field,
  HStack,
  Input,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import {
  getRandomWorkflowIcon,
  WorkflowCreateDialog as WorkflowCreateDialogView,
  type WorkflowTemplateCardProps,
} from "@langwatch/workflow-web";
import { studioWorkflowWireSchema, type StudioWorkflow } from "@langwatch/workflow-contract";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { applyHandledErrorToForm, FormServerError, showErrorToast } from "~/features/errors";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { EmojiPickerModal } from "../../optimization_studio/components/properties/modals/EmojiPickerModal";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";
import { IsolatedErrorBoundary } from "../ui/IsolatedErrorBoundary";
import { WorkflowCard } from "../../optimization_studio/components/workflow/WorkflowCard";

type WorkflowCreationFormData = {
  name: string;
  icon: string;
  description: string;
};

export const CreateWorkflowButton = ({ props }: { props?: ButtonProps }) => {
  const { open, onClose, onOpen } = useDisclosure();

  return (
    <>
      <Button
        data-testid="active-create-new-workflow-button"
        onClick={onOpen}
        size="sm"
        variant="outline"
        {...props}
      >
        <Plus size={16} />
        Create Workflow
      </Button>
      <WorkflowCreateDialog open={open} onClose={onClose} />
    </>
  );
};

export function WorkflowCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <WorkflowCreateDialogView
      open={open}
      onClose={onClose}
      onImportError={(error) => {
        toaster.create({ ...error, type: "error" });
      }}
      renderContentBoundary={(children) => (
        <IsolatedErrorBoundary>{children}</IsolatedErrorBoundary>
      )}
      renderForm={({ template }) => <NewWorkflowForm template={template} onClose={onClose} />}
      renderTemplateCard={(props) => <WorkflowTemplateCard {...props} />}
    />
  );
}

function WorkflowTemplateCard({ testId, dragging, children, ...props }: WorkflowTemplateCardProps) {
  return (
    <WorkflowCard
      {...props}
      data-testid={testId}
      {...(dragging ? { borderStyle: "dashed", borderColor: "blue.500" } : {})}
    >
      {children}
    </WorkflowCard>
  );
}

function NewWorkflowForm({ template, onClose }: { template: StudioWorkflow; onClose: () => void }) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const emojiPicker = useDisclosure();
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
  const createWorkflowMutation = api.workflow.create.useMutation();
  const icon = watch("icon");

  const onSubmit = async (data: WorkflowCreationFormData) => {
    if (!project) return;

    const newWorkflow = studioWorkflowWireSchema.parse({
      ...template,
      version: "1",
      name: data.name,
      description: data.description,
      icon: data.icon ?? defaultIcon,
    });

    createWorkflowMutation.mutate(
      {
        projectId: project.id,
        dsl: newWorkflow,
        commitMessage: "Workflow creation",
      },
      {
        onSuccess: (createdWorkflow) => {
          trackEvent("workflow_create", { project_id: project.id });
          onClose();
          void router.push(`/${project.slug}/studio/${createdWorkflow.workflow.id}`);
        },
        onError: (error) => {
          if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;

          showErrorToast({
            error,
            fallbackTitle: "Couldn't create workflow",
          });
        },
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
    <form onSubmit={handleSubmit(onSubmit)}>
      <Dialog.Body>
        <VStack gap={4} align="stretch">
          <FormServerError form={form} />

          <Field.Root invalid={!!errors.name || !!errors.icon}>
            <EmojiPickerModal
              open={emojiPicker.open}
              onClose={emojiPicker.onClose}
              onChange={(emoji) => {
                setValue("icon", emoji);
                emojiPicker.onClose();
              }}
            />
            <Field.Label>Name and Icon</Field.Label>
            <HStack>
              <Button variant="outline" onClick={emojiPicker.onOpen} fontSize="18px">
                {icon}
              </Button>
              <Input
                {...register("name", { required: "Name is required" })}
                ref={nameRef}
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
      </Dialog.Body>
      <Dialog.Footer>
        <Button
          type="submit"
          colorPalette="blue"
          loading={createWorkflowMutation.isPending}
          onClick={() => {
            void handleSubmit(onSubmit)();
          }}
        >
          Create StudioWorkflow
        </Button>
      </Dialog.Footer>
    </form>
  );
}
