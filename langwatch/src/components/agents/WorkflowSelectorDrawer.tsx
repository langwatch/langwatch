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
import { UpgradeModal } from "~/components/UpgradeModal";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import {
  extractLimitExceededInfo,
  type LimitExceededInfo,
} from "~/utils/trpcError";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";
import { DEFAULT_MODEL } from "~/utils/constants";
import { trackEvent } from "~/utils/tracking";
import type { Workflow } from "~/optimization_studio/types/dsl";
import { blankTemplate } from "~/optimization_studio/templates/blank";
import { getRandomWorkflowIcon } from "~/optimization_studio/components/workflow/NewWorkflowForm";
import { EmojiPickerModal } from "~/optimization_studio/components/properties/modals/EmojiPickerModal";

export type WorkflowSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** Name for the new agent (optional, prompts if not provided) */
  agentName?: string;
};

type FormData = {
  name: string;
  icon: string;
  description: string;
};

/**
 * Drawer for creating a new workflow-based agent.
 * Features:
 * - Creates a new workflow from the blank template
 * - Creates an agent linked to the new workflow
 * - Navigates to the workflow studio for editing
 */
export function WorkflowSelectorDrawer(props: WorkflowSelectorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useContext();
  const router = useRouter();
  const emojiPicker = useDisclosure();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as WorkflowSelectorDrawerProps["onSave"]);
  const isOpen = props.open !== false && props.open !== undefined;

  // State for upgrade modal when limit is exceeded
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [limitInfo, setLimitInfo] = useState<LimitExceededInfo | null>(null);

  const [defaultIcon] = useState(getRandomWorkflowIcon());

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: props.agentName ?? "Custom Agent",
      icon: defaultIcon,
      description: "",
    },
  });

  const icon = watch("icon");
  const name = watch("name");

  const createWorkflowMutation = api.workflow.create.useMutation();
  const createAgentMutation = api.agents.create.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.(agent);
    },
    onError: (error) => {
      const limitExceeded = extractLimitExceededInfo(error);
      if (limitExceeded?.limitType === "agents") {
        setLimitInfo(limitExceeded);
        setShowUpgradeModal(true);
        return;
      }
      toaster.create({
        title: "Error creating agent",
        description: error.message,
        type: "error",
      });
    },
  });

  const isSaving =
    createWorkflowMutation.isPending || createAgentMutation.isPending;

  const onSubmit = useCallback(
    async (data: FormData) => {
      if (!project) return;

      try {
        // Create workflow from blank template
        const template = blankTemplate;
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
          commitMessage: "Workflow creation for agent",
        });

        trackEvent("workflow_create", { project_id: project.id });

        // Build DSL-compatible Custom component config
        const config = {
          name: data.name.trim(),
          isCustom: true,
          workflow_id: createdWorkflow.workflow.id,
        };

        // Create agent linked to the new workflow
        await createAgentMutation.mutateAsync({
          projectId: project.id,
          name: data.name.trim(),
          type: "workflow",
          config,
          workflowId: createdWorkflow.workflow.id,
        });

        // Close drawer and navigate to workflow studio
        onClose();
        void router.push(
          `/${project.slug}/studio/${createdWorkflow.workflow.id}`,
        );
      } catch (error) {
        const limitExceeded = extractLimitExceededInfo(error);
        if (limitExceeded?.limitType === "workflows") {
          setLimitInfo(limitExceeded);
          setShowUpgradeModal(true);
          return;
        }
        console.error("Error creating workflow agent:", error);
        toaster.create({
          title: "Error",
          description: "Failed to create workflow agent",
          type: "error",
        });
      }
    },
    [
      project,
      defaultIcon,
      createWorkflowMutation,
      createAgentMutation,
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
              <Heading>Create Workflow Agent</Heading>
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
                Create a new workflow to use as a custom agent. You&apos;ll be
                taken to the workflow editor to configure the agent logic.
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
                        placeholder="Enter agent name"
                        data-testid="agent-name-input"
                      />
                    </HStack>
                    <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
                  </Field.Root>

                  <Field.Root invalid={!!errors.description}>
                    <Field.Label>Description (optional)</Field.Label>
                    <Textarea
                      {...register("description")}
                      placeholder="What does this agent do?"
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
                colorPalette="blue"
                onClick={() => void handleSubmit(onSubmit)()}
                disabled={!isValid || isSaving}
                loading={isSaving}
                data-testid="save-agent-button"
              >
                Create & Open Editor
              </Button>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        limitType={limitInfo?.limitType ?? "agents"}
        current={limitInfo?.current}
        max={limitInfo?.max}
      />
    </>
  );
}
