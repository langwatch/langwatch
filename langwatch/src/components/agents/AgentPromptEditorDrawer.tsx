import {
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, FormProvider, useFieldArray } from "react-hook-form";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TypedAgent } from "~/server/agents/agent.repository";

import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "~/components/ModelSelector";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { usePromptConfigForm } from "~/prompts/hooks/usePromptConfigForm";
import type { PromptConfigFormValues } from "~/prompts/types";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";

export type AgentPromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** If provided, loads an existing agent for editing */
  agentId?: string;
};

/**
 * Converts PromptConfigFormValues to agent config format
 * Note: System prompt is now part of the messages array (role: "system")
 */
const formValuesToAgentConfig = (formValues: PromptConfigFormValues) => {
  return {
    llm: formValues.version?.configData?.llm,
    messages: formValues.version?.configData?.messages,
    inputs: formValues.version?.configData?.inputs,
    outputs: formValues.version?.configData?.outputs,
  };
};

/**
 * Converts agent config to PromptConfigFormValues format
 * Handles migration from old format (with separate prompt) to new format (system message in messages array)
 */
const agentConfigToInitialValues = (
  config: Record<string, unknown> | null
): Partial<PromptConfigFormValues> => {
  if (!config) return {};

  // Handle migration: if old config has separate `prompt` field, convert to system message
  let messages = config.messages as PromptConfigFormValues["version"]["configData"]["messages"] | undefined;

  if (config.prompt && typeof config.prompt === "string") {
    // Old format: had separate prompt field - migrate to system message
    const hasSystemMessage = messages?.some(msg => msg.role === "system");
    if (!hasSystemMessage) {
      messages = [
        { role: "system" as const, content: config.prompt as string },
        ...(messages ?? []),
      ];
    }
  }

  return {
    version: {
      configData: {
        llm: config.llm as PromptConfigFormValues["version"]["configData"]["llm"],
        messages: messages ?? [],
        inputs: config.inputs as PromptConfigFormValues["version"]["configData"]["inputs"],
        outputs: config.outputs as PromptConfigFormValues["version"]["configData"]["outputs"],
      },
    },
  };
};

/**
 * Drawer for creating/editing a prompt-based agent.
 * Features:
 * - Name input field
 * - LLM model selection
 * - Message editor (system prompt + user messages)
 * - Save/Cancel buttons
 */
export function AgentPromptEditorDrawer(props: AgentPromptEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave = props.onSave ?? (complexProps.onSave as AgentPromptEditorDrawerProps["onSave"]);
  const agentId =
    props.agentId ??
    drawerParams.agentId ??
    (complexProps.agentId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Form state
  const [name, setName] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load existing agent if editing
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id && isOpen }
  );

  // Build initial values from agent config or defaults
  const initialConfigValues = useMemo(() => {
    if (agentQuery.data?.config) {
      return agentConfigToInitialValues(
        agentQuery.data.config as Record<string, unknown>
      );
    }
    return buildDefaultFormValues();
  }, [agentQuery.data]);

  // Form setup using the prompts module hook
  const { methods } = usePromptConfigForm({
    initialConfigValues,
    onChange: () => {
      setHasUnsavedChanges(true);
    },
  });

  // Initialize name from agent data
  useEffect(() => {
    if (agentQuery.data) {
      setName(agentQuery.data.name);
      setHasUnsavedChanges(false);
    } else if (!agentId && isOpen) {
      // Reset form for new agent
      setName("");
      methods.reset(buildDefaultFormValues());
      setHasUnsavedChanges(false);
    }
  }, [agentQuery.data, agentId, isOpen, methods]);

  // Message fields array for PromptMessagesField
  const messageFields = useFieldArray({
    control: methods.control,
    name: "version.configData.messages",
  });

  // Mutations
  const createMutation = api.agents.create.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.(agent);
      onClose();
    },
  });

  const updateMutation = api.agents.update.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.agents.getById.invalidate({ id: agent.id, projectId: project?.id ?? "" });
      onSave?.(agent);
      onClose();
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isValid = name.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid) return;

    const formValues = methods.getValues();
    const config = formValuesToAgentConfig(formValues);

    if (agentId) {
      updateMutation.mutate({
        id: agentId,
        projectId: project.id,
        name: name.trim(),
        config,
      });
    } else {
      createMutation.mutate({
        projectId: project.id,
        name: name.trim(),
        type: "signature",
        config,
      });
    }
  }, [project?.id, agentId, name, isValid, methods, createMutation, updateMutation]);

  const handleNameChange = (value: string) => {
    setName(value);
    setHasUnsavedChanges(true);
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to close?")) {
        return;
      }
    }
    onClose();
  };

  // Get model option for display
  const currentModel = methods.watch("version.configData.llm.model") ?? "";
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    currentModel,
    "chat"
  );

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
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
            <Heading>
              {agentId ? "Edit Prompt Agent" : "New Prompt Agent"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {agentId && agentQuery.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <FormProvider {...methods}>
              <VStack
                as="form"
                gap={4}
                align="stretch"
                flex={1}
                paddingX={6}
                paddingY={4}
                overflowY="auto"
              >
                {/* Name field */}
                <Field.Root required>
                  <Field.Label>Agent Name</Field.Label>
                  <Input
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Enter agent name"
                    data-testid="agent-name-input"
                  />
                </Field.Root>

                {/* LLM Model selection */}
                <VerticalFormControl
                  label="Model"
                  invalid={!!methods.formState.errors.version?.configData?.llm}
                  helper={methods.formState.errors.version?.configData?.llm?.message?.toString()}
                  error={methods.formState.errors.version?.configData?.llm}
                  size="sm"
                >
                  <Controller
                    name="version.configData.llm"
                    control={methods.control}
                    render={({ field }) => (
                      <LLMConfigField
                        llmConfig={field.value}
                        onChange={(values) => {
                          field.onChange(values);
                          setHasUnsavedChanges(true);
                        }}
                        modelOption={modelOption}
                        requiresCustomKey={false}
                      />
                    )}
                  />
                </VerticalFormControl>

                {/* Messages (includes system prompt + user messages) */}
                <PromptMessagesField
                  messageFields={messageFields}
                  availableFields={[]}
                  otherNodesFields={{}}
                />
              </VStack>
            </FormProvider>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-agent-button"
            >
              {agentId ? "Save Changes" : "Create Agent"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
