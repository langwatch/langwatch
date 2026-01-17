import {
  Box,
  Button,
  Circle,
  Heading,
  HStack,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import debounce from "lodash-es/debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useFieldArray } from "react-hook-form";
import { LuArrowLeft, LuPencil } from "react-icons/lu";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import {
  type AvailableSource,
  type FieldMapping,
  FormVariablesSection,
} from "~/components/variables";
import { useEvaluationMappings } from "~/evaluations-v3/hooks/useEvaluationMappings";
import type { LocalPromptConfig } from "~/evaluations-v3/types";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { PromptEditorHeader } from "~/prompts/components/PromptEditorHeader";
import { VersionBadge } from "~/prompts/components/ui/VersionBadge";
import { ChangeHandleDialog } from "~/prompts/forms/ChangeHandleDialog";
import { PromptMessagesField } from "~/prompts/forms/fields/message-history-fields/PromptMessagesField";
import {
  type SaveDialogFormValues,
  SaveVersionDialog,
} from "~/prompts/forms/SaveVersionDialog";
import type { ChangeHandleFormValues } from "~/prompts/forms/schemas/change-handle-form.schema";
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";
import { usePromptConfigForm } from "~/prompts/hooks/usePromptConfigForm";
import type { PromptConfigFormValues } from "~/prompts/types";
import { areFormValuesEqual } from "~/prompts/utils/areFormValuesEqual";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import {
  formValuesToTriggerSaveVersionParams,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import type { LlmConfigInputType } from "~/types";
import { api } from "~/utils/api";

export type PromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: Array<{ identifier: string; type: string }>;
    outputs?: Array<{ identifier: string; type: string }>;
  }) => void;
  /** If provided, loads an existing prompt for editing */
  promptId?: string;
  /**
   * If provided, fetches this specific version instead of the latest.
   * Used when editing a prompt that has local changes based on an older version.
   */
  promptVersionId?: string;
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
  onInputMappingsChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
  /**
   * Callback when a version is loaded from history (for evaluations context).
   * Called before the form is reset with the new version data.
   */
  onVersionChange?: (prompt: {
    version: number;
    versionId: string;
    inputs?: Array<{ identifier: string; type: string }>;
    outputs?: Array<{ identifier: string; type: string }>;
  }) => void;
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

  // Check if we're in evaluations context (targetId in URL params)
  const targetId = drawerParams.targetId as string | undefined;

  // Use the reactive hook for evaluations context - this subscribes to store updates
  // and automatically provides updated mappings when the active dataset changes
  const evaluationData = useEvaluationMappings(targetId);

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    flowCallbacks?.onSave ??
    (complexProps.onSave as PromptEditorDrawerProps["onSave"]);
  const onLocalConfigChange =
    props.onLocalConfigChange ?? flowCallbacks?.onLocalConfigChange;
  const onVersionChange =
    props.onVersionChange ??
    (flowCallbacks?.onVersionChange as PromptEditorDrawerProps["onVersionChange"]);

  // Data sources: In evaluations context, use reactive data from hook.
  // Otherwise, fall back to props/complexProps (for standalone usage like prompt playground).
  const availableSources =
    targetId && evaluationData.isValid
      ? evaluationData.availableSources
      : (props.availableSources ??
        (complexProps.availableSources as PromptEditorDrawerProps["availableSources"]));

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
  const _mappingsFromProps =
    targetId && evaluationData.isValid
      ? evaluationData.inputMappings
      : (props.inputMappings ??
        (complexProps.inputMappings as PromptEditorDrawerProps["inputMappings"]));

  // External callback to persist changes to store
  const _onMappingsChangeProp =
    props.onInputMappingsChange ??
    flowCallbacks?.onInputMappingsChange ??
    (complexProps.onInputMappingsChange as PromptEditorDrawerProps["onInputMappingsChange"]);

  // THE source of truth for mappings inside this drawer
  const [inputMappings, setInputMappings] = useState<
    Record<string, FieldMapping> | undefined
  >(_mappingsFromProps);

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
    [_onMappingsChangeProp],
  );

  const promptId =
    props.promptId ??
    drawerParams.promptId ??
    (complexProps.promptId as string | undefined);
  // Get the specific version ID if provided (for editing pinned versions)
  const promptVersionId =
    props.promptVersionId ??
    drawerParams.promptVersionId ??
    (complexProps.promptVersionId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Load existing prompt if editing
  // If promptVersionId is provided, fetch that specific version instead of latest
  const promptQuery = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: promptId ?? "",
      projectId: project?.id ?? "",
      // Note: versionId was added to the tRPC router but types may need regeneration
      versionId: promptVersionId, // Fetch specific version if provided
    } as { idOrHandle: string; projectId: string; versionId?: string },
    {
      enabled: !!promptId && !!project?.id && isOpen,
      refetchOnWindowFocus: false,
    },
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

  // ============================================================================
  // CONFIG VALUES STATE - Single Source of Truth for Form Initialization
  // ============================================================================
  //
  // configValues: The baseline config that the form uses. Updated on:
  //   1. Initialization (when drawer opens)
  //   2. After save (with fresh server data)
  //
  // isFormInitialized: Tracks whether we've done the initial setup for this
  //   drawer session. Prevents re-initialization when deps change.
  //
  const [configValues, setConfigValues] = useState<PromptConfigFormValues>(
    buildDefaultFormValues,
  );
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  // Form setup using the prompts module hook
  const { methods } = usePromptConfigForm({
    initialConfigValues: configValues,
  });

  // Track unsaved changes state - updated via subscription, not watch()
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Refs for callbacks (these need to be refs because they're used in subscriptions)
  const onLocalConfigChangeRef = useRef(onLocalConfigChange);
  onLocalConfigChangeRef.current = onLocalConfigChange;
  // NOTE: savedFormValuesRef is updated in useEffect below, NOT on every render.
  // This prevents the ref from being overwritten with stale query data after save
  // (the onSuccess handler sets fresh values, which would be lost if we overwrote here).
  const savedFormValuesRef = useRef(savedFormValues);
  const promptIdRef = useRef(promptId);
  promptIdRef.current = promptId;

  // Initialize form when drawer opens and data is available
  useEffect(() => {
    if (isFormInitialized) return;
    if (!isOpen) return;

    if (promptQuery.data) {
      const serverValues =
        versionedPromptToPromptConfigFormValuesWithSystemMessage(
          promptQuery.data,
        );

      // Merge local config over server data if present
      const formValues = props.initialLocalConfig
        ? {
            ...serverValues,
            version: {
              ...serverValues.version,
              configData: {
                ...serverValues.version.configData,
                llm: {
                  model: props.initialLocalConfig.llm.model,
                  temperature: props.initialLocalConfig.llm.temperature,
                  maxTokens: props.initialLocalConfig.llm.maxTokens,
                  litellmParams: props.initialLocalConfig.llm.litellmParams,
                },
                messages: props.initialLocalConfig.messages,
                inputs: props.initialLocalConfig
                  .inputs as typeof serverValues.version.configData.inputs,
                outputs: props.initialLocalConfig
                  .outputs as typeof serverValues.version.configData.outputs,
              },
            },
          }
        : serverValues;

      setConfigValues(formValues);
      // IMPORTANT: savedFormValuesRef should be the SERVER values, not form values.
      // If we have local changes (initialLocalConfig), form will differ from saved,
      // which keeps hasUnsavedChanges=true and doesn't clear the local config.
      savedFormValuesRef.current = serverValues;
      methods.reset(formValues);
      setIsFormInitialized(true);
    } else if (!promptId) {
      // New prompt - use defaults
      const defaults = buildDefaultFormValues();
      setConfigValues(defaults);
      methods.reset(defaults);
      setIsFormInitialized(true);

      // Auto-map default inputs to matching dataset columns
      if (
        availableSources &&
        availableSources.length > 0 &&
        _onMappingsChangeProp
      ) {
        const allFields = availableSources.flatMap((source) =>
          source.fields.map((f) => ({ ...f, sourceId: source.id })),
        );

        for (const input of defaults.version.configData.inputs) {
          // Find a matching field by name (case-insensitive)
          const matchingField = allFields.find(
            (f) => f.name.toLowerCase() === input.identifier.toLowerCase(),
          );

          if (matchingField) {
            const mapping: FieldMapping = {
              type: "source",
              sourceId: matchingField.sourceId,
              field: matchingField.name,
            };
            // Update local state
            setInputMappings((prev) => ({
              ...prev,
              [input.identifier]: mapping,
            }));
            // Persist to store
            _onMappingsChangeProp(input.identifier, mapping);
          }
        }
      }
    }
  }, [
    isOpen,
    promptQuery.data,
    promptId,
    props.initialLocalConfig,
    methods,
    isFormInitialized,
    availableSources,
    _onMappingsChangeProp,
  ]);

  // Reset when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setIsFormInitialized(false);
    }
  }, [isOpen]);

  // Reset when switching prompts, versions, or targets
  useEffect(() => {
    setIsFormInitialized(false);
  }, [promptId, promptVersionId, targetId]);

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

  // Update hasUnsavedChanges when savedFormValues changes (e.g., after query refetch)
  // Also sync the ref here (not on every render, to avoid overwriting onSuccess updates)
  useEffect(() => {
    if (savedFormValues) {
      savedFormValuesRef.current = savedFormValues;
      const currentValues = methods.getValues();
      const isUnsaved = !areFormValuesEqual(currentValues, savedFormValues);
      setHasUnsavedChanges(isUnsaved);
    }
  }, [savedFormValues, methods]);

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
        version: prompt.version,
        versionId: prompt.versionId,
        inputs: prompt.inputs,
        outputs: prompt.outputs,
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
      // Build fresh form values from server response
      const freshFormValues =
        versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);

      // Update configValues state - this is THE key fix!
      // This ensures the forward sync in usePromptConfigForm sees form matches configValues
      // and doesn't restore stale data from props.initialLocalConfig
      setConfigValues(freshFormValues);

      // Update savedFormValuesRef BEFORE resetting the form.
      // This ensures the form subscription sees the correct "saved" values
      // and doesn't incorrectly think there are unsaved changes.
      savedFormValuesRef.current = freshFormValues;

      // Reset form to match the fresh values
      methods.reset(freshFormValues);

      void utils.prompts.getAllPromptsForProject.invalidate({
        projectId: project?.id ?? "",
      });
      void utils.prompts.getByIdOrHandle.invalidate({
        idOrHandle: promptId ?? "",
        projectId: project?.id ?? "",
      });
      // Invalidate version history so the history button shows the new version
      void utils.prompts.getAllVersionsForPrompt.invalidate({
        idOrHandle: promptId ?? "",
        projectId: project?.id ?? "",
      });
      onSave?.({
        id: prompt.id,
        name: prompt.handle ?? "Untitled",
        version: prompt.version,
        versionId: prompt.versionId,
        inputs: prompt.inputs,
        outputs: prompt.outputs,
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

  const updateHandleMutation = api.prompts.updateHandle.useMutation({
    onSuccess: (prompt) => {
      // Refetch the prompt query to get the updated handle
      void promptQuery.refetch();
      void utils.prompts.getAllPromptsForProject.invalidate({
        projectId: project?.id ?? "",
      });
      toaster.create({
        title: "Prompt renamed",
        description: `Prompt handle changed to "${prompt.handle}"`,
        type: "success",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Error renaming prompt",
        description: error.message,
        type: "error",
      });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  // Form is always valid for the save button - actual validation happens when saving
  const isValid = true;

  // State for save version dialog (asks for commit message when updating existing prompt)
  const [saveVersionDialogOpen, setSaveVersionDialogOpen] = useState(false);
  // State for save prompt dialog (asks for handle when creating new prompt)
  const [savePromptDialogOpen, setSavePromptDialogOpen] = useState(false);
  // State for change handle dialog (for renaming existing prompts)
  const [changeHandleDialogOpen, setChangeHandleDialogOpen] = useState(false);
  const pendingSaveDataRef = useRef<ReturnType<
    typeof formValuesToTriggerSaveVersionParams
  > | null>(null);

  // Validate and prepare save data, returns true if ready to save
  const validateAndPrepare = useCallback(async () => {
    if (!project?.id) return false;

    // Validate form
    const formValid = await methods.trigger("version.configData.llm");
    if (!formValid) {
      toaster.create({
        title: "Validation error",
        description: "Please fix the LLM configuration errors before saving",
        type: "error",
      });
      return false;
    }

    const formValues = methods.getValues();
    pendingSaveDataRef.current =
      formValuesToTriggerSaveVersionParams(formValues);
    return true;
  }, [project?.id, methods]);

  // Execute the save with a commit message (and optional handle/scope for new prompts)
  const executeSave = useCallback(
    (
      commitMessage: string,
      newPromptData?: { handle: string; scope: "PROJECT" | "ORGANIZATION" },
    ) => {
      if (!project?.id || !pendingSaveDataRef.current) return;

      const saveData = pendingSaveDataRef.current;

      if (promptId && promptQuery.data?.id) {
        // Update existing prompt
        updateMutation.mutate({
          projectId: project.id,
          id: promptQuery.data.id,
          data: {
            ...saveData,
            commitMessage,
          },
        });
      } else if (newPromptData) {
        // Create new prompt
        createMutation.mutate({
          projectId: project.id,
          data: {
            ...saveData,
            handle: newPromptData.handle,
            scope: newPromptData.scope,
            commitMessage,
          },
        });
      }
    },
    [
      project?.id,
      promptId,
      promptQuery.data?.id,
      createMutation,
      updateMutation,
    ],
  );

  // Handle save button click
  const handleSave = useCallback(async () => {
    const isReady = await validateAndPrepare();
    if (!isReady) return;

    if (promptId && promptQuery.data?.id) {
      // For existing prompts, show the save version dialog to get commit message
      setSaveVersionDialogOpen(true);
    } else {
      // For new prompts, show the save prompt dialog to get handle
      setSavePromptDialogOpen(true);
    }
  }, [validateAndPrepare, promptId, promptQuery.data?.id]);

  // Handle save version dialog submit (for existing prompts)
  const handleSaveVersionSubmit = useCallback(
    async (formValues: SaveDialogFormValues) => {
      executeSave(formValues.commitMessage);
      setSaveVersionDialogOpen(false);
    },
    [executeSave],
  );

  // Handle save prompt dialog submit (for new prompts)
  const handleSavePromptSubmit = useCallback(
    async (formValues: ChangeHandleFormValues) => {
      executeSave("Initial version", {
        handle: formValues.handle,
        scope: formValues.scope,
      });
      setSavePromptDialogOpen(false);
    },
    [executeSave],
  );

  // Handle change handle dialog submit (for renaming existing prompts)
  const handleChangeHandleSubmit = useCallback(
    async (formValues: ChangeHandleFormValues) => {
      if (!project?.id || !promptQuery.data?.id) return;
      updateHandleMutation.mutate({
        projectId: project.id,
        id: promptQuery.data.id,
        data: formValues,
      });
      setChangeHandleDialogOpen(false);
    },
    [project?.id, promptQuery.data?.id, updateHandleMutation],
  );

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

  // Handle version history restore
  const handleVersionRestore = async (prompt: VersionedPrompt) => {
    // Notify evaluations context about the version change (if in evaluations context)
    // This updates the target's version info before we reset the form
    onVersionChange?.({
      version: prompt.version,
      versionId: prompt.versionId,
      inputs: prompt.inputs,
      outputs: prompt.outputs,
    });

    const newFormValues =
      versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt);
    // Update savedFormValuesRef to the restored version's values
    // This ensures hasUnsavedChanges is false after restore
    savedFormValuesRef.current = newFormValues;
    methods.reset(newFormValues);
  };

  // Version drift detection - use the dedicated hook to get actual latest from DB
  // Note: When promptVersionId is passed, promptQuery returns that specific version,
  // not the latest. We need useLatestPromptVersion to detect drift properly.
  const currentVersion = methods.watch("versionMetadata.versionNumber");
  const { latestVersion, isOutdated, nextVersion } = useLatestPromptVersion({
    configId: promptId,
    currentVersion,
  });

  // Show version badge only when pinned to a specific version (not "latest")
  // i.e., when promptVersionId is passed from evaluations context
  const showVersionBadge = !!promptVersionId && currentVersion !== undefined;

  // Upgrade to latest version - need to fetch the actual latest
  const handleUpgradeToLatest = useCallback(async () => {
    if (!promptId || !project?.id) return;
    try {
      // Fetch the actual latest version (not the pinned one)
      const latestPrompt = await utils.prompts.getByIdOrHandle.fetch({
        idOrHandle: promptId,
        projectId: project.id,
      });
      if (!latestPrompt) return;

      const newFormValues =
        versionedPromptToPromptConfigFormValuesWithSystemMessage(latestPrompt);
      // Update savedFormValuesRef to the latest version's values
      // This ensures hasUnsavedChanges is false after upgrade
      savedFormValuesRef.current = newFormValues;
      methods.reset(newFormValues);

      // Also notify parent about the version change
      onVersionChange?.({
        version: latestPrompt.version,
        versionId: latestPrompt.versionId,
        inputs: latestPrompt.inputs,
        outputs: latestPrompt.outputs,
      });
    } catch (error) {
      console.error("Failed to upgrade to latest version:", error);
    }
  }, [
    promptId,
    project?.id,
    utils.prompts.getByIdOrHandle,
    methods,
    onVersionChange,
  ]);

  // Handle setting variable mapping when selecting a source field from the text area
  const handleSetVariableMapping = useCallback(
    (identifier: string, sourceId: string, fieldName: string) => {
      // First, ensure the variable exists
      const rawInputs = methods.getValues("version.configData.inputs");
      const currentInputs = Array.isArray(rawInputs) ? rawInputs : [];
      const variableExists = currentInputs.some(
        (input: { identifier: string }) => input.identifier === identifier,
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
    [methods, availableSources, onInputMappingsChange],
  );

  // Get available fields for message editor (with type information)
  const watchedInputs = methods.watch("version.configData.inputs");
  const availableFields = (
    Array.isArray(watchedInputs) ? watchedInputs : []
  ).map((input) => ({
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
    const inputIds = new Set(
      inputs.map((i: { identifier: string }) => i.identifier),
    );

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
  const _configId = promptQuery.data?.id;

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
            {promptId && promptQuery.data?.handle ? (
              <>
                <HStack
                  gap={1}
                  cursor="pointer"
                  onClick={() => setChangeHandleDialogOpen(true)}
                  _hover={{ "& .edit-icon": { display: "block" } }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setChangeHandleDialogOpen(true);
                    }
                  }}
                >
                  <Heading>{promptQuery.data.handle}</Heading>
                  <Box
                    className="edit-icon"
                    display="none"
                    transition="opacity 0.2s"
                    color="gray.500"
                  >
                    <LuPencil size={16} />
                  </Box>
                </HStack>
                {showVersionBadge && (
                  <VersionBadge
                    version={currentVersion!}
                    latestVersion={latestVersion}
                    onUpgrade={isOutdated ? handleUpgradeToLatest : undefined}
                  />
                )}
                {hasUnsavedChanges && (
                  <Tooltip
                    content="Unpublished modifications"
                    positioning={{ placement: "top" }}
                    openDelay={0}
                    showArrow
                  >
                    <Circle size="10px" bg="orange.400" />
                  </Tooltip>
                )}
              </>
            ) : (
              <Heading>New Prompt</Heading>
            )}
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
                {/* Header bar - shared with prompt playground */}
                <Box
                  borderBottomWidth="1px"
                  borderColor="gray.200"
                  paddingX={4}
                  paddingY={3}
                  position="sticky"
                  top={0}
                  zIndex={1}
                  background="white"
                >
                  <PromptEditorHeader
                    onSave={() => void handleSave()}
                    hasUnsavedChanges={hasUnsavedChanges}
                    isValid={isValid}
                    isSaving={isSaving}
                    onVersionRestore={handleVersionRestore}
                  />
                </Box>

                {/* Save Version Dialog - asks for commit message when updating */}
                <SaveVersionDialog
                  isOpen={saveVersionDialogOpen}
                  onClose={() => setSaveVersionDialogOpen(false)}
                  onSubmit={handleSaveVersionSubmit}
                  nextVersion={nextVersion}
                />

                {/* Save Prompt Dialog - asks for handle when creating new prompt */}
                <ChangeHandleDialog
                  isOpen={savePromptDialogOpen}
                  onClose={() => setSavePromptDialogOpen(false)}
                  onSubmit={handleSavePromptSubmit}
                />

                {/* Change Handle Dialog - for renaming existing prompts */}
                <ChangeHandleDialog
                  isOpen={changeHandleDialogOpen}
                  onClose={() => setChangeHandleDialogOpen(false)}
                  currentHandle={promptQuery.data?.handle}
                  currentScope={promptQuery.data?.scope}
                  onSubmit={handleChangeHandleSubmit}
                />

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

                {/* Variables */}
                <Box paddingX={4} paddingBottom={4}>
                  <FormVariablesSection
                    title="Variables"
                    showMappings={
                      !!availableSources && availableSources.length > 0
                    }
                    availableSources={availableSources}
                    mappings={inputMappings}
                    onMappingChange={onInputMappingsChange}
                    missingMappingIds={missingMappingIds}
                    lockedVariables={new Set(["input"])}
                    variableInfo={{
                      input:
                        "This is the user message input. It will be sent as the user message to the LLM.",
                    }}
                    showAddButton={false}
                  />
                </Box>
              </VStack>
            </FormProvider>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
