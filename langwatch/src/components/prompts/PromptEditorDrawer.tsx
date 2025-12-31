import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useFieldArray } from "react-hook-form";
import debounce from "lodash-es/debounce";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";

import { FormVariablesSection } from "~/components/variables";
import { usePromptConfigForm } from "~/prompts/hooks/usePromptConfigForm";
import type { PromptConfigFormValues } from "~/prompts/types";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";
import { OutputsFieldGroup } from "~/prompts/forms/fields/PromptConfigVersionFieldGroup";
import { ModelSelectFieldMini } from "~/prompts/forms/fields/ModelSelectFieldMini";
import { VersionHistoryButton } from "~/prompts/forms/prompt-config-form/components/VersionHistoryButton";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";
import { areFormValuesEqual } from "~/prompts/utils/areFormValuesEqual";
import type { LocalPromptConfig } from "~/evaluations-v3/types";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

export type PromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (prompt: { id: string; name: string; versionId?: string }) => void;
  /** If provided, loads an existing prompt for editing */
  promptId?: string;
  /**
   * For evaluations context: callback to persist local changes when closing without save.
   * If provided, closing with unsaved changes will call this instead of showing a warning.
   * Pass undefined to clear local changes (when form matches saved state).
   */
  onLocalConfigChange?: (config: LocalPromptConfig | undefined) => void;
  /**
   * Initial local config to load (for resuming unpublished changes).
   */
  initialLocalConfig?: LocalPromptConfig;
};

/**
 * Extracts LocalPromptConfig from form values for persisting unpublished changes.
 */
const extractLocalConfig = (
  formValues: PromptConfigFormValues,
): LocalPromptConfig => ({
  llm: {
    model: formValues.version.configData.llm.model,
    temperature: formValues.version.configData.llm.temperature,
    maxTokens: formValues.version.configData.llm.maxTokens,
    litellmParams: formValues.version.configData.llm.litellmParams,
  },
  messages: formValues.version.configData.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })),
  inputs: formValues.version.configData.inputs.map((i) => ({
    identifier: i.identifier,
    type: i.type,
  })) as LocalPromptConfig["inputs"],
  outputs: formValues.version.configData.outputs.map((o) => ({
    identifier: o.identifier,
    type: o.type,
    json_schema: o.json_schema,
  })) as LocalPromptConfig["outputs"],
});

/**
 * Drawer for creating/editing prompts.
 * Features:
 * - Header with model selector, version history, and Save/Saved button (matches prompt playground)
 * - Message editor (system + user messages)
 * - Inputs and outputs configuration
 * - Integrates with the Prompts versioning system
 * - Supports local tinkering in evaluations context (close without save persists locally)
 */
export function PromptEditorDrawer(props: PromptEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ?? (complexProps.onSave as PromptEditorDrawerProps["onSave"]);
  const onLocalConfigChange = props.onLocalConfigChange;
  const promptId =
    props.promptId ??
    drawerParams.promptId ??
    (complexProps.promptId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Handle state for new prompts
  const [handle, setHandle] = useState("");

  // Load existing prompt if editing
  const promptQuery = api.prompts.getByIdOrHandle.useQuery(
    { idOrHandle: promptId ?? "", projectId: project?.id ?? "" },
    { enabled: !!promptId && !!project?.id && isOpen },
  );

  // Compute saved form values from the published prompt
  const savedFormValues = useMemo(() => {
    if (promptQuery.data) {
      return versionedPromptToPromptConfigFormValuesWithSystemMessage(
        promptQuery.data,
      );
    }
    return undefined;
  }, [promptQuery.data]);

  // Build initial values from prompt data, local config, or defaults
  const initialConfigValues = useMemo(() => {
    // If we have local config (unpublished changes), use that
    if (props.initialLocalConfig && savedFormValues) {
      // Merge local config over base values
      return {
        ...savedFormValues,
        version: {
          ...savedFormValues.version,
          configData: {
            ...savedFormValues.version.configData,
            llm: {
              model: props.initialLocalConfig.llm.model,
              temperature: props.initialLocalConfig.llm.temperature,
              maxTokens: props.initialLocalConfig.llm.maxTokens,
              litellmParams: props.initialLocalConfig.llm.litellmParams,
            },
            messages: props.initialLocalConfig.messages,
            inputs: props.initialLocalConfig
              .inputs as typeof savedFormValues.version.configData.inputs,
            outputs: props.initialLocalConfig
              .outputs as typeof savedFormValues.version.configData.outputs,
          },
        },
      };
    }
    if (savedFormValues) {
      return savedFormValues;
    }
    return buildDefaultFormValues();
  }, [savedFormValues, props.initialLocalConfig]);

  // Form setup using the prompts module hook
  const { methods } = usePromptConfigForm({
    initialConfigValues,
  });

  // Track unsaved changes state - updated via subscription, not watch()
  // This avoids re-rendering the entire component on every keystroke
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Create stable refs for callbacks and values
  const onLocalConfigChangeRef = useRef(onLocalConfigChange);
  onLocalConfigChangeRef.current = onLocalConfigChange;
  const savedFormValuesRef = useRef(savedFormValues);
  savedFormValuesRef.current = savedFormValues;
  const promptIdRef = useRef(promptId);
  promptIdRef.current = promptId;

  // Debounced function to update local config (avoids flooding store on every keystroke)
  const debouncedUpdateLocalConfig = useMemo(
    () =>
      debounce(
        (config: LocalPromptConfig | undefined) => {
          onLocalConfigChangeRef.current?.(config);
        },
        500,
        { leading: true },
      ),
    [],
  );

  // Subscribe to form changes WITHOUT causing re-renders
  // This is the key to avoiding focus loss and performance issues
  useEffect(() => {
    const subscription = methods.watch((formValues) => {
      // Compute hasUnsavedChanges
      let isUnsaved = false;
      if (!promptIdRef.current) {
        // For new prompts, check if there's any content
        const messages = formValues.version?.configData?.messages ?? [];
        isUnsaved = messages.some((m) => m?.content?.trim());
      } else if (savedFormValuesRef.current) {
        // For existing prompts, compare with saved values
        isUnsaved = !areFormValuesEqual(
          formValues as PromptConfigFormValues,
          savedFormValuesRef.current,
        );
      }

      // Update hasUnsavedChanges state only if it changed
      setHasUnsavedChanges((prev) => {
        if (prev === isUnsaved) return prev;
        return isUnsaved;
      });

      // Update local config for evaluations context
      if (onLocalConfigChangeRef.current && promptIdRef.current) {
        if (isUnsaved) {
          debouncedUpdateLocalConfig(
            extractLocalConfig(formValues as PromptConfigFormValues),
          );
        } else {
          // Clear local config when back to saved state
          debouncedUpdateLocalConfig.cancel();
          onLocalConfigChangeRef.current(undefined);
        }
      }
    });

    return () => {
      subscription.unsubscribe();
      debouncedUpdateLocalConfig.cancel();
    };
  }, [methods, debouncedUpdateLocalConfig]);

  // Update hasUnsavedChanges when savedFormValues changes (e.g., after save)
  useEffect(() => {
    if (savedFormValues) {
      const currentValues = methods.getValues();
      const isUnsaved = !areFormValuesEqual(currentValues, savedFormValues);
      setHasUnsavedChanges(isUnsaved);
    }
  }, [savedFormValues, methods]);

  // Initialize form from prompt data
  useEffect(() => {
    if (promptQuery.data) {
      // Reset form with loaded data to ensure it's properly populated
      if (props.initialLocalConfig) {
        // Use local config if available
        const baseValues =
          versionedPromptToPromptConfigFormValuesWithSystemMessage(
            promptQuery.data,
          );
        methods.reset({
          ...baseValues,
          version: {
            ...baseValues.version,
            configData: {
              ...baseValues.version.configData,
              llm: {
                model: props.initialLocalConfig.llm.model,
                temperature: props.initialLocalConfig.llm.temperature,
                maxTokens: props.initialLocalConfig.llm.maxTokens,
                litellmParams: props.initialLocalConfig.llm.litellmParams,
              },
              messages: props.initialLocalConfig.messages,
              inputs: props.initialLocalConfig
                .inputs as typeof baseValues.version.configData.inputs,
              outputs: props.initialLocalConfig
                .outputs as typeof baseValues.version.configData.outputs,
            },
          },
        });
      } else {
        methods.reset(
          versionedPromptToPromptConfigFormValuesWithSystemMessage(
            promptQuery.data,
          ),
        );
      }
    } else if (!promptId && isOpen) {
      // Reset form for new prompt
      methods.reset(buildDefaultFormValues());
    }
  }, [promptQuery.data, promptId, isOpen, methods, props.initialLocalConfig]);

  // Message fields array for PromptMessagesField
  const messageFields = useFieldArray({
    control: methods.control,
    name: "version.configData.messages",
  });

  // Mutations
  const createMutation = api.prompts.create.useMutation({
    onSuccess: (prompt) => {
      void utils.prompts.getAllPromptsForProject.invalidate({
        projectId: project?.id ?? "",
      });
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
      void utils.prompts.getAllPromptsForProject.invalidate({
        projectId: project?.id ?? "",
      });
      void utils.prompts.getByIdOrHandle.invalidate({
        idOrHandle: promptId ?? "",
        projectId: project?.id ?? "",
      });
      onSave?.({
        id: prompt.id,
        name: prompt.handle ?? "Untitled",
      });
      // Don't close - let user continue editing or close manually
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
  }, [
    project?.id,
    promptId,
    promptQuery.data?.id,
    handle,
    isValid,
    methods,
    createMutation,
    updateMutation,
  ]);

  const handleHandleChange = (value: string) => {
    setHandle(value);
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      // If we have a local config change handler (evaluations context), just close
      // Local config is already being updated on every change
      if (onLocalConfigChange) {
        onClose();
        return;
      }
      // Otherwise, warn about losing changes
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?",
        )
      ) {
        return;
      }
    }
    onClose();
  };

  // Discard changes and restore to the current published version
  const handleDiscardChanges = useCallback(() => {
    if (!savedFormValues) return;
    methods.reset(savedFormValues);
    // The useEffect will automatically clear local config since hasUnsavedChanges will become false
  }, [savedFormValues, methods]);

  // Handle version history restore
  const handleVersionRestore = async (prompt: VersionedPrompt) => {
    const newFormValues =
      versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);
    methods.reset(newFormValues);
  };

  // Get available fields for message editor (with type information)
  const availableFields = (
    methods.watch("version.configData.inputs") ?? []
  ).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Get configId for version history
  const configId = promptQuery.data?.id;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="sm"
      closeOnInteractOutside={false}
      modal={false}
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
            <Heading>{promptId ? "Edit Prompt" : "New Prompt"}</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
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
                overflowY="auto"
              >
                {/* Header bar - matches prompt playground */}
                <Box
                  borderBottomWidth="1px"
                  borderColor="gray.200"
                  paddingX={4}
                  paddingY={3}
                  bg="white"
                  position="sticky"
                  top={0}
                  zIndex={1}
                >
                  <HStack width="full">
                    <ModelSelectFieldMini />
                    <Spacer />
                    <HStack gap={2}>
                      {configId && (
                        <VersionHistoryButton
                          configId={configId}
                          onRestoreSuccess={handleVersionRestore}
                          onDiscardChanges={handleDiscardChanges}
                          hasUnsavedChanges={hasUnsavedChanges}
                        />
                      )}
                      <Button
                        colorPalette="blue"
                        size="sm"
                        onClick={() => void handleSave()}
                        disabled={!hasUnsavedChanges || !isValid || isSaving}
                        loading={isSaving}
                        data-testid="save-prompt-button"
                      >
                        {hasUnsavedChanges ? "Save" : "Saved"}
                      </Button>
                    </HStack>
                  </HStack>
                </Box>

                {/* Handle/name field - only for new prompts */}
                {!promptId && (
                  <Box paddingX={4}>
                    <Field.Root required>
                      <Field.Label>Prompt Name (Handle)</Field.Label>
                      <Input
                        value={handle}
                        onChange={(e) => handleHandleChange(e.target.value)}
                        placeholder="my-assistant"
                        data-testid="prompt-handle-input"
                      />
                      <Field.HelperText>
                        Use lowercase letters, numbers, and hyphens. Can include
                        folder prefix like "shared/my-prompt"
                      </Field.HelperText>
                    </Field.Root>
                  </Box>
                )}

                {/* Messages (includes system prompt + user messages) */}
                <Box paddingX={4}>
                  <PromptMessagesField
                    messageFields={messageFields}
                    availableFields={availableFields}
                    otherNodesFields={{}}
                  />
                </Box>

                {/* Variables and Outputs */}
                <Box paddingX={4} paddingBottom={4}>
                  <VStack gap={4} align="stretch">
                    <FormVariablesSection showMappings={false} title="Variables" />
                    <OutputsFieldGroup />
                  </VStack>
                </Box>
              </VStack>
            </FormProvider>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
