/**
 * Creating a workflow, from a template or from an imported file.
 *
 * A MOVE of `platform/app/src/components/workflows/CreateWorkflowButton.tsx`,
 * which was already an adapter over this package's own `WorkflowCreateDialog`
 * view: what it added was the transport, the form, the icon picker and the
 * navigation to the new workflow's studio. All of that is here now.
 *
 * THE CREATE ENDS BY LEAVING THIS PAGE, and it is the reason this family's host
 * port has a `navigate` at all: a created workflow is only useful in the
 * studio, which `platform/app` still serves at `/:project/studio/:id`. A page
 * moved into a package and an address still served by the application are the
 * same product to the reader, and the route table is what makes that true.
 *
 * `trackEvent("workflow_create")` did not travel. It is the application's own
 * product-analytics client, there is no capability that answers for it, and a
 * feature-web package may not reach a browser singleton. RECORDED rather than
 * reimplemented.
 *
 * `applyHandledErrorToForm` did not travel either — it reads the code-keyed
 * presentation registry, which is the application's. A refused create reports
 * through the host's failure notice, so the registry still decides the words;
 * what is lost is the field-level placement of a validation refusal, and the
 * only fields here are a name and a description.
 */

import { Button, Field, HStack, Input, Textarea, useDisclosure, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { studioWorkflowWireSchema, type StudioWorkflow } from "@langwatch/workflow-contract";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { workflowApi } from "../../behavior/workflow-api";
import { useWorkflowHost } from "../../model/workflow-host";
import { getRandomWorkflowIcon } from "../../model/random-workflow-icon";
import {
  WorkflowCreateDialog as WorkflowCreateDialogView,
  type WorkflowTemplateCardProps,
} from "../elements/workflow-create-dialog";
import { WorkflowEmojiPicker } from "../blocks/workflow-emoji-picker";
import { WorkflowErrorBoundary } from "../elements/workflow-error-boundary";
import { WorkflowListCard } from "./workflow-list-card";

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
      renderForm={({ template }) => <NewWorkflowForm template={template} onClose={onClose} />}
      renderTemplateCard={(props) => <WorkflowTemplateCard {...props} />}
    />
  );
}

function WorkflowTemplateCard({ testId, dragging, children, ...props }: WorkflowTemplateCardProps) {
  return (
    <WorkflowListCard
      {...props}
      data-testid={testId}
      {...(dragging ? { borderStyle: "dashed", borderColor: "blue.500" } : {})}
    >
      {children}
    </WorkflowListCard>
  );
}

function NewWorkflowForm({ template, onClose }: { template: StudioWorkflow; onClose: () => void }) {
  const host = useWorkflowHost();
  const { projectId, projectSlug } = host.scope();
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
    <form onSubmit={handleSubmit(onSubmit)}>
      <Dialog.Body>
        <VStack gap={4} align="stretch">
          <Field.Root invalid={!!errors.name || !!errors.icon}>
            <WorkflowEmojiPicker
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
