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
import { toaster } from "~/components/ui/toaster";

import { LLMConfigField } from "~/components/llmPromptConfigs/LlmConfigField";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "~/components/ModelSelector";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { usePromptConfigForm } from "~/prompts/hooks/usePromptConfigForm";
import type { PromptConfigFormValues } from "~/prompts/types";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";
import {
  InputsFieldGroup,
  OutputsFieldGroup,
} from "~/prompts/forms/fields/PromptConfigVersionFieldGroup";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";

export type PromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (prompt: { id: string; name: string; versionId?: string }) => void;
  /** If provided, loads an existing prompt for editing */
  promptId?: string;
};

/**
 * Drawer for creating/editing prompts.
 * Features:
 * - Name/handle input field
 * - LLM model selection
 * - Message editor (system + user messages)
 * - Save/Cancel buttons
 * - Integrates with the Prompts versioning system
 */
export function PromptEditorDrawer(props: PromptEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave = props.onSave ?? (complexProps.onSave as PromptEditorDrawerProps["onSave"]);
  const promptId =
    props.promptId ??
    drawerParams.promptId ??
    (complexProps.promptId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Form state
  const [handle, setHandle] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load existing prompt if editing
  const promptQuery = api.prompts.getByIdOrHandle.useQuery(
    { idOrHandle: promptId ?? "", projectId: project?.id ?? "" },
    { enabled: !!promptId && !!project?.id && isOpen }
  );

  // Build initial values from prompt data or defaults
  const initialConfigValues = useMemo(() => {
    if (promptQuery.data) {
      // Use WithSystemMessage to ensure the system prompt appears in the messages field
      return versionedPromptToPromptConfigFormValuesWithSystemMessage(promptQuery.data);
    }
    return buildDefaultFormValues();
  }, [promptQuery.data]);

  // Form setup using the prompts module hook
  const { methods } = usePromptConfigForm({
    initialConfigValues,
    onChange: () => {
      setHasUnsavedChanges(true);
    },
  });

  // Initialize handle and form from prompt data
  useEffect(() => {
    if (promptQuery.data) {
      setHandle(promptQuery.data.handle ?? "");
      // Reset form with loaded data to ensure it's properly populated
      methods.reset(versionedPromptToPromptConfigFormValuesWithSystemMessage(promptQuery.data));
      setHasUnsavedChanges(false);
    } else if (!promptId && isOpen) {
      // Reset form for new prompt
      setHandle("");
      methods.reset(buildDefaultFormValues());
      setHasUnsavedChanges(false);
    }
  }, [promptQuery.data, promptId, isOpen, methods]);

  // Message fields array for PromptMessagesField
  const messageFields = useFieldArray({
    control: methods.control,
    name: "version.configData.messages",
  });

  // Mutations
  const createMutation = api.prompts.create.useMutation({
    onSuccess: (prompt) => {
      void utils.prompts.getAllPromptsForProject.invalidate({ projectId: project?.id ?? "" });
      onSave?.({
        id: prompt.id,
        name: prompt.handle ?? "Untitled",
      });
      onClose();
    },
    onError: (error) => {
      toaster.create({
        title: "Error creating prompt",
        description: error.message,
        type: "error",
      });
    },
  });

  const updateMutation = api.prompts.update.useMutation({
    onSuccess: (prompt) => {
      void utils.prompts.getAllPromptsForProject.invalidate({ projectId: project?.id ?? "" });
      void utils.prompts.getByIdOrHandle.invalidate({ idOrHandle: promptId ?? "", projectId: project?.id ?? "" });
      onSave?.({
        id: prompt.id,
        name: prompt.handle ?? "Untitled",
      });
      onClose();
    },
    onError: (error) => {
      toaster.create({
        title: "Error updating prompt",
        description: error.message,
        type: "error",
      });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  // For editing, we don't need a new handle since the prompt already has one
  const isValid = promptId ? true : handle.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!project?.id || !isValid) return;

    // Validate form
    const formValid = await methods.trigger("version.configData.llm");
    if (!formValid) {
      toaster.create({
        title: "Validation error",
        description: "Please fix the LLM configuration errors before saving",
        type: "error",
      });
      return;
    }

    const formValues = methods.getValues();
    const saveData = formValuesToTriggerSaveVersionParams(formValues);

    if (promptId && promptQuery.data?.id) {
      // Update existing prompt
      updateMutation.mutate({
        projectId: project.id,
        id: promptQuery.data.id,
        data: {
          ...saveData,
          commitMessage: "Updated via drawer",
        },
      });
    } else {
      // Create new prompt
      createMutation.mutate({
        projectId: project.id,
        data: {
          ...saveData,
          handle: handle.trim(),
          scope: "PROJECT",
          commitMessage: "Initial version",
        },
      });
    }
  }, [project?.id, promptId, promptQuery.data?.id, handle, isValid, methods, createMutation, updateMutation]);

  const handleHandleChange = (value: string) => {
    setHandle(value);
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

  // Get available fields for message editor
  const availableFields = (methods.watch("version.configData.inputs") ?? []).map(
    (input) => input.identifier
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
              {promptId ? "Edit Prompt" : "New Prompt"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {promptId && promptQuery.isLoading ? (
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
                {/* Handle/name field - only for new prompts */}
                {!promptId && (
                  <Field.Root required>
                    <Field.Label>Prompt Name (Handle)</Field.Label>
                    <Input
                      value={handle}
                      onChange={(e) => handleHandleChange(e.target.value)}
                      placeholder="my-assistant"
                      data-testid="prompt-handle-input"
                    />
                    <Field.HelperText>
                      Use lowercase letters, numbers, and hyphens. Can include folder prefix like "shared/my-prompt"
                    </Field.HelperText>
                  </Field.Root>
                )}

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
                  availableFields={availableFields}
                  otherNodesFields={{}}
                />

                {/* Inputs and Outputs */}
                <InputsFieldGroup />
                <OutputsFieldGroup />
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
              onClick={() => void handleSave()}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-prompt-button"
            >
              {promptId ? "Save Changes" : "Create Prompt"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
