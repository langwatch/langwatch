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
import { useDrawer, getComplexProps, useDrawerParams, getFlowCallbacks } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";

import { FormVariablesSection, type AvailableSource, type FieldMapping } from "~/components/variables";
import { useEvaluationMappings } from "~/evaluations-v3/hooks/useEvaluationMappings";
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
import type { LlmConfigInputType } from "~/types";

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
  /**
   * Available sources for variable mapping (e.g., dataset columns).
   * When provided, shows mapping UI instead of simple value inputs.
   */
  availableSources?: AvailableSource[];
  /**
   * Current input mappings (managed by parent, e.g., evaluations store).
   */
  inputMappings?: Record<string, FieldMapping>;
  /**
   * Callback when input mappings change.
   */
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
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
  const flowCallbacks = getFlowCallbacks("promptEditor");
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  // Check if we're in evaluations context (runnerId in URL params)
  const runnerId = drawerParams.runnerId as string | undefined;

  // Use the reactive hook for evaluations context - this subscribes to store updates
  // and automatically provides updated mappings when the active dataset changes
  const evaluationData = useEvaluationMappings(runnerId);

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ?? flowCallbacks?.onSave ?? (complexProps.onSave as PromptEditorDrawerProps["onSave"]);
  const onLocalConfigChange = props.onLocalConfigChange ?? flowCallbacks?.onLocalConfigChange;

  // Data sources: In evaluations context, use reactive data from hook.
  // Otherwise, fall back to props/complexProps (for standalone usage like prompt playground).
  const availableSources = runnerId && evaluationData.isValid
    ? evaluationData.availableSources
    : props.availableSources ?? (complexProps.availableSources as PromptEditorDrawerProps["availableSources"]);

  // ============================================================================
  // INPUT MAPPINGS - Single Source of Truth Pattern
  // ============================================================================
  //
  // ARCHITECTURE: `inputMappings` (local state) is THE source of truth inside this drawer.
  // - Initialized from props/store when drawer opens
  // - ALL reads inside this drawer use `inputMappings`
  // - Changes update local state immediately (responsive UI)
  // - Changes also flow OUT to store via callback (persistence)
  // - External changes (e.g., dataset switch) sync back via useEffect
  //
  // DO NOT use `_mappingsFromProps` directly - it's only for initialization/sync.
  // ============================================================================

  // External source (only for initialization and sync)
  const _mappingsFromProps = runnerId && evaluationData.isValid
    ? evaluationData.inputMappings
    : props.inputMappings ?? (complexProps.inputMappings as PromptEditorDrawerProps["inputMappings"]);

  // External callback to persist changes to store
  const _onMappingsChangeProp = props.onInputMappingsChange ?? flowCallbacks?.onInputMappingsChange ?? (complexProps.onInputMappingsChange as PromptEditorDrawerProps["onInputMappingsChange"]);

  // THE source of truth for mappings inside this drawer
  const [inputMappings, setInputMappings] = useState<Record<string, FieldMapping> | undefined>(_mappingsFromProps);

  // Sync from external when props change (e.g., drawer reopened, dataset changed)
  useEffect(() => {
    setInputMappings(_mappingsFromProps);
  }, [_mappingsFromProps]);

  // Handler that updates local state AND persists to store
  const onInputMappingsChange = useCallback(
    (identifier: string, mapping: FieldMapping | undefined) => {
      // Update local state immediately for responsive UI
      setInputMappings((prev) => {
        const newMappings = { ...prev };
        if (mapping) {
          newMappings[identifier] = mapping;
        } else {
          delete newMappings[identifier];
        }
        return newMappings;
      });
      // Persist to store via external callback
      _onMappingsChangeProp?.(identifier, mapping);
    },
    [_onMappingsChangeProp]
  );

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
    { enabled: !!promptId && !!project?.id && isOpen, refetchOnWindowFocus: false },
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

  // Handle setting variable mapping when selecting a source field from the text area
  const handleSetVariableMapping = useCallback(
    (identifier: string, sourceId: string, fieldName: string) => {
      // First, ensure the variable exists
      const rawInputs = methods.getValues("version.configData.inputs");
      const currentInputs = Array.isArray(rawInputs) ? rawInputs : [];
      const variableExists = currentInputs.some(
        (input: { identifier: string }) => input.identifier === identifier
      );

      if (!variableExists) {
        // Find the source field to get its type
        const source = availableSources?.find((s) => s.id === sourceId);
        const sourceField = source?.fields.find((f) => f.name === fieldName);
        const fieldType = sourceField?.type ?? "str";

        // Map source type to our input type (default to "str" for unknown types)
        const typeMap: Record<string, LlmConfigInputType> = {
          string: "str",
          str: "str",
          number: "float",
          float: "float",
          int: "float",
          boolean: "bool",
          bool: "bool",
          image: "image",
          dict: "dict",
          list: "str", // Default list to str for now
        };
        const inputType: LlmConfigInputType = typeMap[fieldType] ?? "str";

        // Add the variable
        methods.setValue("version.configData.inputs", [
          ...currentInputs,
          { identifier, type: inputType },
        ]);
      }

      // Then set the mapping (if callback provided)
      if (onInputMappingsChange) {
        onInputMappingsChange(identifier, {
          type: "source",
          sourceId,
          field: fieldName,
        });
      }
    },
    [methods, availableSources, onInputMappingsChange]
  );

  // Get available fields for message editor (with type information)
  const watchedInputs = methods.watch("version.configData.inputs");
  const availableFields = (Array.isArray(watchedInputs) ? watchedInputs : []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Watch messages to calculate which variables are used
  const watchedMessages = methods.watch("version.configData.messages");

  // Calculate missing mapping IDs for highlighting in the variables section
  // A variable is missing if it's BOTH used in the prompt AND in the inputs list, but has no mapping
  // Uses `inputMappings` which is the single source of truth inside this drawer.
  const missingMappingIds = useMemo(() => {
    // Only show missing mappings if we're in evaluations context (have availableSources)
    if (!availableSources || availableSources.length === 0) {
      return new Set<string>();
    }

    // Extract variables used in messages
    const usedVariables = new Set<string>();
    const messages = Array.isArray(watchedMessages) ? watchedMessages : [];
    for (const msg of messages) {
      const content = msg?.content ?? "";
      const pattern = /\{\{(\w+)\}\}/g;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        usedVariables.add(match[1]!);
      }
    }

    // Get input identifiers
    const inputs = Array.isArray(watchedInputs) ? watchedInputs : [];
    const inputIds = new Set(inputs.map((i: { identifier: string }) => i.identifier));

    // Find variables that are both used and defined but missing a mapping
    const missing = new Set<string>();
    for (const varId of usedVariables) {
      if (inputIds.has(varId) && !inputMappings?.[varId]) {
        missing.add(varId);
      }
    }

    return missing;
  }, [watchedMessages, watchedInputs, inputMappings, availableSources]);

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
                    availableSources={availableSources}
                    onSetVariableMapping={handleSetVariableMapping}
                  />
                </Box>

                {/* Variables and Outputs */}
                <Box paddingX={4} paddingBottom={4}>
                  <VStack gap={4} align="stretch">
                    <FormVariablesSection
                      title="Variables"
                      showMappings={!!availableSources && availableSources.length > 0}
                      availableSources={availableSources}
                      mappings={inputMappings}
                      onMappingChange={onInputMappingsChange}
                      missingMappingIds={missingMappingIds}
                    />
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
