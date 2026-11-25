import { getComplexProps, getFlowCallbacks, useDrawer } from "@langwatch/browser-host/drawer";
import { applyHandledErrorToForm, showErrorToast } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Drawer } from "@langwatch/design-system/drawer";
import { EmojiPicker } from "@langwatch/design-system/emoji-picker";
import { Field, HStack, Input, Text, Textarea, VStack } from "@langwatch/design-system/primitives";
import { evaluatorClient } from "@langwatch/evaluator-client";
import { createLogger } from "@langwatch/observability/browser";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";

import { evaluatorApi } from "../../../behavior/evaluator-api.ts";
import { getRandomWorkflowIcon } from "../../../model/workflow/random-workflow-icon.ts";
import { customEvaluatorTemplate } from "../../../model/workflow/templates/custom-evaluator.template.ts";
import { FormServerError } from "../../elements/workflow/studio-host/errors.tsx";

const logger = createLogger("langwatch:evaluator:workflow-selector");

/** What a caller hands evaluator's drawer that creates a workflow-based evaluator. */
export type WorkflowSelectorForEvaluatorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: { id: string; name: string; workflowId: string }) => void;
  /** Name for the new evaluator (optional, prompts if not provided) */
  evaluatorName?: string;
};

type FormData = {
  name: string;
  icon: string;
  description: string;
};

/**
 * Drawer for creating a new workflow-based evaluator. Features: - Creates a new workflow from
 * the custom_evaluator template - Creates an evaluator linked to the new workflow - Navigates
 * to the workflow studio for editing
 */
export function WorkflowSelectorForEvaluatorDrawer(props: WorkflowSelectorForEvaluatorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const utils = evaluatorClient.useUtils();
  const router = useRouter();

  const onClose = props.onClose ?? closeDrawer;
  const flowCallbacks = getFlowCallbacks("workflowSelectorForEvaluator");
  const onSave =
    props.onSave ??
    flowCallbacks?.onSave ??
    (complexProps.onSave as WorkflowSelectorForEvaluatorDrawerProps["onSave"]);
  const isOpen = props.open !== false && props.open !== undefined;

  const [defaultIcon] = useState(getRandomWorkflowIcon());

  const form = useForm<FormData>({
    defaultValues: {
      name: props.evaluatorName ?? "",
      icon: defaultIcon,
      description: "",
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const icon = watch("icon");

  const createWorkflowMutation = evaluatorApi.workflow.create.useMutation();
  const createEvaluatorMutation = evaluatorClient.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.({
        id: evaluator.id,
        name: evaluator.name,
        workflowId: evaluator.workflowId ?? "",
      });
    },
    // No `onError` here on purpose: the only caller awaits `mutateAsync`
    // inside `onSubmit`, and react-query runs both, so reporting in each
    // stacks two identical toasts for one failure. The catch owns it — it
    // has the headline that names the whole action.
  });

  const isSaving = createWorkflowMutation.isPending || createEvaluatorMutation.isPending;

  const onSubmit = useCallback(
    async (data: FormData) => {
      if (!project) return;

      try {
        // Create workflow from custom_evaluator template. LLM nodes without
        // a model are materialized server-side from the project's resolved
        // default.
        const template = customEvaluatorTemplate;
        const newWorkflow: StudioWorkflow = {
          ...template,
          name: data.name,
          description: data.description,
          icon: data.icon ?? defaultIcon,
        };

        const createdWorkflow = await createWorkflowMutation.mutateAsync({
          projectId: project.id,
          dsl: newWorkflow,
          commitMessage: "Workflow creation for evaluator",
          publish: true, // Auto-publish so the evaluator can run immediately
        });

        // The `workflow_create` product event does not travel: `~/utils/tracking`
        // has no package home, and the two copies that exist elsewhere are no-op
        // stubs, so registering a third would record nothing either.

        // Create evaluator linked to the new workflow
        await createEvaluatorMutation.mutateAsync({
          projectId: project.id,
          name: data.name.trim(),
          type: "workflow",
          config: {},
          workflowId: createdWorkflow.workflow.id,
        });

        // Close drawer and navigate to workflow studio
        onClose();
        void router.push(`/${project.slug}/studio/${createdWorkflow.workflow.id}`);
      } catch (error) {
        logger.error({ error }, "Error creating workflow evaluator");
        if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
        showErrorToast({
          error,
          fallbackTitle: "Couldn't create workflow evaluator",
        });
      }
    },
    [project, defaultIcon, createWorkflowMutation, createEvaluatorMutation, onClose, router, form],
  );

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      onBack={canGoBack ? goBack : void 0}
      backButtonTestId="back-button"
      size="md"
      title="Create Workflow Evaluator"
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: "Create & Open Editor",
          onClick: () => {
            if (isSaving) return;
            void handleSubmit(onSubmit)();
          },
          loading: isSaving,
          "data-testid": "save-evaluator-button",
        },
      }}
    >
      <VStack gap={4} align="stretch">
        <Text color="fg.muted" fontSize="sm">
          Create a new workflow to use as a custom evaluator. You&apos;ll be taken to the workflow
          editor to configure the evaluation logic.
        </Text>

        <FormServerError form={form} />

        <Field.Root invalid={!!errors.name || !!errors.icon}>
          <Field.Label>Name and icon</Field.Label>
          <HStack>
            <EmojiPicker value={icon} onChange={(emoji) => setValue("icon", emoji)} />
            <Input
              {...register("name", {
                validate: (value) => value.trim().length > 0 || "Enter a name for the evaluator.",
              })}
              placeholder="Enter evaluator name"
              data-testid="evaluator-name-input"
            />
          </HStack>
          <Field.ErrorText>{errors.name?.message ?? errors.icon?.message}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={!!errors.description}>
          <Field.Label>Description (optional)</Field.Label>
          <Textarea {...register("description")} placeholder="What does this evaluator check?" />
          <Field.ErrorText>{errors.description?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Drawer>
  );
}
