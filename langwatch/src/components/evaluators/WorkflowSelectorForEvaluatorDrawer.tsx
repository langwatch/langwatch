import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Text,
  Textarea,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DEFAULT_MODEL } from "~/utils/constants";
import { trackEvent } from "~/utils/tracking";
import type { Workflow } from "~/optimization_studio/types/dsl";
import { customEvaluatorTemplate } from "~/optimization_studio/templates/custom_evaluator";
import { getRandomWorkflowIcon } from "~/optimization_studio/components/workflow/NewWorkflowForm";
import { EmojiPickerModal } from "~/optimization_studio/components/properties/modals/EmojiPickerModal";

export type WorkflowSelectorForEvaluatorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    workflowId: string;
  }) => void;
  /** Name for the new evaluator (optional, prompts if not provided) */
  evaluatorName?: string;
};

type FormData = {
  name: string;
  icon: string;
  description: string;
};

/**
 * Drawer for creating a new workflow-based evaluator.
 * Features:
 * - Creates a new workflow from the custom_evaluator template
 * - Creates an evaluator linked to the new workflow
 * - Navigates to the workflow studio for editing
 */
export function WorkflowSelectorForEvaluatorDrawer(
  props: WorkflowSelectorForEvaluatorDrawerProps,
) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useContext();
  const router = useRouter();
  const emojiPicker = useDisclosure();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as WorkflowSelectorForEvaluatorDrawerProps["onSave"]);
  const isOpen = props.open !== false && props.open !== undefined;

  // License enforcement for evaluator creation
  const { checkAndProceed } = useLicenseEnforcement("evaluators");

  const [defaultIcon] = useState(getRandomWorkflowIcon());

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: props.evaluatorName ?? "",
      icon: defaultIcon,
      description: "",
    },
  });

  const icon = watch("icon");
  const name = watch("name");

  const createWorkflowMutation = api.workflow.create.useMutation();
  const createEvaluatorMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.({
        id: evaluator.id,
        name: evaluator.name,
        workflowId: evaluator.workflowId ?? "",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Error creating evaluator",
        description: error.message,
        type: "error",
      });
    },
  });

  const isSaving =
    createWorkflowMutation.isPending || createEvaluatorMutation.isPending;

  const onSubmit = useCallback(
    async (data: FormData) => {
      if (!project) return;

      try {
        // Create workflow from custom_evaluator template
        const template = customEvaluatorTemplate;
        const newWorkflow: Workflow = {
          ...template,
          name: data.name,
          description: data.description,
          icon: data.icon ?? defaultIcon,
          default_llm: {
            ...template.default_llm,
            model: project.defaultModel ?? DEFAULT_MODEL,
          },
        };

        const createdWorkflow = await createWorkflowMutation.mutateAsync({
          projectId: project.id,
          dsl: newWorkflow,
          commitMessage: "Workflow creation for evaluator",
          publish: true, // Auto-publish so the evaluator can run immediately
        });

        trackEvent("workflow_create", { project_id: project.id });

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
        void router.push(
          `/${project.slug}/studio/${createdWorkflow.workflow.id}`,
        );
      } catch (error) {
        console.error("Error creating workflow evaluator:", error);
        toaster.create({
          title: "Error",
          description: "Failed to create workflow evaluator",
          type: "error",
        });
      }
    },
    [
      project,
      defaultIcon,
      createWorkflowMutation,
      createEvaluatorMutation,
      onClose,
      router,
    ],
  );

  const isValid = name?.trim().length > 0;

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={({ open }) => !open && onClose()}
        size="md"
      >
        <Drawer.Content>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <HStack gap={2}>
              {canGoBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  padding={1}
                  minWidth="auto"
                  data-testid="back-button"
                >
                  <LuArrowLeft size={20} />
                </Button>
              )}
              <Heading>Create Workflow Evaluator</Heading>
            </HStack>
          </Drawer.Header>
          <Drawer.Body
            display="flex"
            flexDirection="column"
            overflow="hidden"
            padding={0}
          >
            <VStack gap={4} align="stretch" flex={1} overflow="hidden">
              <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
                Create a new workflow to use as a custom evaluator. You&apos;ll
                be taken to the workflow editor to configure the evaluation
                logic.
              </Text>

              <Box paddingX={6}>
                <VStack gap={4} align="stretch">
                  <Field.Root invalid={!!errors.name}>
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
                      <Button
                        variant="outline"
                        onClick={emojiPicker.onOpen}
                        fontSize="18px"
                      >
                        {icon}
                      </Button>
                      <Input
                        {...register("name", { required: "Name is required" })}
                        placeholder="Enter evaluator name"
                        data-testid="evaluator-name-input"
                      />
                    </HStack>
                    <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
                  </Field.Root>

                  <Field.Root invalid={!!errors.description}>
                    <Field.Label>Description (optional)</Field.Label>
                    <Textarea
                      {...register("description")}
                      placeholder="What does this evaluator check?"
                    />
                    <Field.ErrorText>
                      {errors.description?.message}
                    </Field.ErrorText>
                  </Field.Root>
                </VStack>
              </Box>
            </VStack>
          </Drawer.Body>
          <Drawer.Footer borderTopWidth="1px" borderColor="border">
            <HStack gap={3}>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="green"
                onClick={() =>
                  checkAndProceed(() => void handleSubmit(onSubmit)())
                }
                disabled={!isValid || isSaving}
                loading={isSaving}
                data-testid="save-evaluator-button"
              >
                Create & Open Editor
              </Button>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
