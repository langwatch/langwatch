import { Box, Button, Circle, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/browser-host/use-drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { LocalPromptConfig } from "@langwatch/experiment-contract";
import {
  type AvailableSource,
  type FieldMapping,
  FormVariablesSection,
  VersionBadge,
} from "@langwatch/prompt-browser-kit";
import { hasNonEmptySystemMessage } from "@langwatch/prompt-contract";
import { useRegisterDrawerFooter } from "@langwatch/workflow-browser-kit";
import { type ReactNode, useCallback, useMemo } from "react";
import { FormProvider, useFieldArray, useWatch } from "react-hook-form";
import { LuArrowLeft, LuPencil } from "react-icons/lu";

import { useLatestPromptVersion } from "../../../behavior/prompts/use-latest-prompt-version.ts";
import {
  useEditorInputMappings,
  usePromptEditorForm,
} from "../../../behavior/prompts/use-prompt-editor-form.ts";
import { usePromptEditorSave } from "../../../behavior/prompts/use-prompt-editor-save.ts";
import { useModelProvidersSettings } from "../../../behavior/use-model-providers-settings.ts";
import {
  inputTypeForField,
  missingMappingIdsFor,
} from "../../../model/prompts/prompt-editor-values.ts";
import { FormOutputsSection } from "../../elements/outputs/form-outputs-section.tsx";
import { SaveVersionDialog } from "../../elements/prompts/forms/save-version-dialog.tsx";
import { PromptMessagesField } from "../prompt-studio/fields/prompt-messages-field.tsx";
import { ChangeHandleDialog } from "./forms/change-handle-dialog.tsx";
import { PromptEditorFooter } from "./prompt-editor-footer.tsx";
import { PromptEditorHeader } from "./prompt-editor-header.tsx";

export type PromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: { identifier: string; type: string }[];
    // json_schema flows to the target so structured outputs stay field-selectable
    // in the comparison config — see promptEditorCallbacks.onSave.
    outputs?: {
      identifier: string;
      type: string;
      json_schema?: object | null;
    }[];
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
   * Fallback config used ONLY when `promptId` is set but the prompt is not found in the
   * project (e.g. a workflow imported from another project).
   */
  inlineConfigFallback?: LocalPromptConfig;
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
  /**
   * Callback when a version is loaded from history (for evaluations context).
   * Called before the form is reset with the new version data.
   */
  onVersionChange?: (prompt: {
    version: number;
    versionId: string;
    inputs?: { identifier: string; type: string }[];
    outputs?: { identifier: string; type: string }[];
  }) => void;
  /** When true, renders form content without Drawer shell (for embedding in external drawer) */
  headless?: boolean;
};

type EditorSave = ReturnType<typeof usePromptEditorSave>;
type EditorMethods = ReturnType<typeof usePromptEditorForm>["methods"];

/**
 * What the drawer was opened with: its own props first, then the flow
 * callbacks and complex props the opener registered. An experiment keeps
 * `availableSources` and `inputMappings` current as its active dataset changes.
 */
function useEditorOpenedWith(props: PromptEditorDrawerProps) {
  const { closeDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const flowCallbacks = getFlowCallbacks("promptEditor");
  const drawerParams = useDrawerParams();

  return {
    // Set when an experiment opened this drawer for one of its targets.
    targetId: drawerParams.targetId as string | undefined,
    onClose: props.onClose ?? closeDrawer,
    onSave:
      props.onSave ??
      flowCallbacks?.onSave ??
      (complexProps.onSave as PromptEditorDrawerProps["onSave"]),
    onLocalConfigChange: props.onLocalConfigChange ?? flowCallbacks?.onLocalConfigChange,
    onVersionChange:
      props.onVersionChange ??
      (flowCallbacks?.onVersionChange as PromptEditorDrawerProps["onVersionChange"]),
    availableSources:
      props.availableSources ??
      (complexProps.availableSources as PromptEditorDrawerProps["availableSources"]),
    inputMappings:
      props.inputMappings ??
      (complexProps.inputMappings as PromptEditorDrawerProps["inputMappings"]),
    onInputMappingsChange:
      props.onInputMappingsChange ??
      flowCallbacks?.onInputMappingsChange ??
      (complexProps.onInputMappingsChange as PromptEditorDrawerProps["onInputMappingsChange"]),
    promptId:
      props.promptId ?? drawerParams.promptId ?? (complexProps.promptId as string | undefined),
    // The pinned version, when editing one.
    promptVersionId:
      props.promptVersionId ??
      drawerParams.promptVersionId ??
      (complexProps.promptVersionId as string | undefined),
    isOpen: props.headless ? true : props.open === true,
  };
}

/**
 * Picking a source field from the textarea: declares the variable (typed from
 * the field) when it is new, then maps it to that field.
 */
function useSetVariableMapping({
  methods,
  availableSources,
  onInputMappingsChange,
}: {
  methods: EditorMethods;
  availableSources: AvailableSource[] | undefined;
  onInputMappingsChange: (identifier: string, mapping: FieldMapping | undefined) => void;
}) {
  return useCallback(
    (identifier: string, sourceId: string, fieldName: string) => {
      const rawInputs = methods.getValues("version.configData.inputs");
      const currentInputs = Array.isArray(rawInputs) ? rawInputs : [];
      if (!currentInputs.some((input) => input.identifier === identifier)) {
        const source = availableSources?.find((s) => s.id === sourceId);
        const fieldType = source?.fields.find((f) => f.name === fieldName)?.type ?? "str";
        methods.setValue("version.configData.inputs", [
          ...currentInputs,
          { identifier, type: inputTypeForField(fieldType) },
        ]);
      }
      onInputMappingsChange(identifier, { type: "source", sourceId, path: [fieldName] });
    },
    [methods, availableSources, onInputMappingsChange],
  );
}

/** The drawer's title: the prompt's handle (click to rename), its version and unsaved mark. */
function EditorTitle({
  handle,
  onRename,
  versionBadge,
  hasUnsavedChanges,
}: {
  handle: string | undefined;
  onRename: () => void;
  versionBadge: ReactNode;
  hasUnsavedChanges: boolean;
}) {
  if (!handle) return <Heading>New Prompt</Heading>;
  return (
    <>
      <HStack asChild gap={1} cursor="pointer" _hover={{ "& .edit-icon": { display: "block" } }}>
        <button type="button" onClick={onRename}>
          <Heading>{handle}</Heading>
          <Box className="edit-icon" display="none" transition="opacity 0.2s" color="fg.muted">
            <LuPencil size={16} />
          </Box>
        </button>
      </HStack>
      {versionBadge}
      {hasUnsavedChanges && (
        <Tooltip
          content="Unpublished modifications"
          positioning={{ placement: "top" }}
          openDelay={0}
          showArrow
        >
          <Circle size="10px" bg="orange.400" data-testid="unsaved-changes-indicator" />
        </Tooltip>
      )}
    </>
  );
}

/** The three dialogs saving and renaming open. */
function EditorDialogs({
  save,
  nextVersion,
  storedPrompt,
}: {
  save: EditorSave;
  nextVersion: number | undefined;
  storedPrompt: { handle?: string | null; scope?: "PROJECT" | "ORGANIZATION" } | null | undefined;
}) {
  return (
    <>
      {/* Asks for a commit message when updating */}
      <SaveVersionDialog
        isOpen={save.saveVersionDialog.open}
        onClose={save.saveVersionDialog.onClose}
        onSubmit={save.saveVersionDialog.onSubmit}
        nextVersion={nextVersion}
      />
      {/* Asks for a handle when creating */}
      <ChangeHandleDialog
        isOpen={save.savePromptDialog.open}
        onClose={save.savePromptDialog.onClose}
        onSubmit={save.savePromptDialog.onSubmit}
      />
      {/* Renames an existing prompt */}
      <ChangeHandleDialog
        isOpen={save.changeHandleDialog.open}
        onClose={save.changeHandleDialog.onClose}
        currentHandle={storedPrompt?.handle}
        currentScope={storedPrompt?.scope}
        onSubmit={save.changeHandleDialog.onSubmit}
      />
    </>
  );
}

/**
 * Drawer for creating and editing prompts, standalone or embedded headless in
 * another drawer; in an experiment it edits one target and maps its variables.
 */
export function PromptEditorDrawer(props: PromptEditorDrawerProps) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const { modelMetadata } = useModelProvidersSettings({ projectId: project?.id });
  const { canGoBack, goBack } = useDrawer();
  const opened = useEditorOpenedWith(props);
  const { targetId, promptId, promptVersionId, isOpen, availableSources } = opened;

  // The cascade-resolved model for prompts created here.
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );

  const { inputMappings, setInputMappings, onInputMappingsChange } = useEditorInputMappings({
    fromProps: opened.inputMappings,
    onChangeProp: opened.onInputMappingsChange,
  });

  // The pinned version when one is named, else the latest.
  const promptQuery = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: promptId ?? "",
      projectId: project?.id ?? "",
      versionId: promptVersionId,
    } as { idOrHandle: string; projectId: string; versionId?: string },
    { enabled: !!promptId && !!project?.id && isOpen, refetchOnWindowFocus: false },
  );

  const form = usePromptEditorForm({
    isOpen,
    promptId,
    promptVersionId,
    targetId,
    prompt: { data: promptQuery.data, isLoading: promptQuery.isLoading },
    initialLocalConfig: props.initialLocalConfig,
    inlineConfigFallback: props.inlineConfigFallback,
    modelMetadata,
    resolvedDefaultModel: resolvedDefault.data?.model,
    onLocalConfigChange: opened.onLocalConfigChange,
    availableSources,
    onMappingsChangeProp: opened.onInputMappingsChange,
    setInputMappings,
  });
  const { methods, hasUnsavedChanges, debouncedUpdateLocalConfig } = form;

  const save = usePromptEditorSave({
    project,
    hasPermission,
    promptId,
    storedPrompt: promptQuery.data,
    refetchPrompt: promptQuery.refetch,
    methods,
    onSave: opened.onSave,
    onClose: opened.onClose,
    onVersionChange: opened.onVersionChange,
    setConfigValues: form.setConfigValues,
    resetToSaved: form.resetToSaved,
  });

  const messageFields = useFieldArray({
    control: methods.control,
    name: "version.configData.messages",
  });
  // Watched so Save and the inline error follow the system-prompt rule as the user types (#3196).
  const isValid = hasNonEmptySystemMessage(
    useWatch({ control: methods.control, name: "version.configData.messages" }),
  );

  const handleClose = () => {
    // With a local-config handler (an experiment) the edits are already kept;
    // otherwise closing on unsaved changes asks first.
    const asksFirst = hasUnsavedChanges && !opened.onLocalConfigChange;
    if (asksFirst && !window.confirm("You have unsaved changes. Are you sure you want to close?")) {
      return;
    }
    debouncedUpdateLocalConfig.flush();
    opened.onClose();
  };

  // Drift reads the actual latest: a pinned promptVersionId makes promptQuery
  // return that version.
  const currentVersion = methods.watch("versionMetadata.versionNumber");
  const { latestVersion, isOutdated, nextVersion } = useLatestPromptVersion({
    configId: promptId,
    currentVersion,
  });

  const handleSetVariableMapping = useSetVariableMapping({
    methods,
    availableSources,
    onInputMappingsChange,
  });

  const watchedInputs = methods.watch("version.configData.inputs");
  const inputs = Array.isArray(watchedInputs) ? watchedInputs : [];
  const availableFields = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));
  const watchedMessages = methods.watch("version.configData.messages");
  const missingMappingIds = useMemo(
    () =>
      missingMappingIdsFor({
        messages: Array.isArray(watchedMessages) ? watchedMessages : [],
        inputs: Array.isArray(watchedInputs) ? watchedInputs : [],
        inputMappings,
        availableSources,
      }),
    [watchedMessages, watchedInputs, inputMappings, availableSources],
  );
  const hasSources = !!availableSources && availableSources.length > 0;

  // Rendered outside the body's FormProvider (Drawer.Footer or the wrapper's
  // footer slot), so it carries its own.
  const footerElement = (
    <FormProvider {...methods}>
      <PromptEditorFooter
        onSave={() => void save.handleSave()}
        hasUnsavedChanges={hasUnsavedChanges}
        isValid={isValid}
        isSaving={save.isSaving}
        onVersionRestore={save.handleVersionRestore}
        configId={promptQuery.data?.id}
        handle={promptQuery.data?.handle ?? undefined}
        currentVersionId={methods.watch("versionMetadata")?.versionId}
        onApply={targetId || props.headless ? handleClose : undefined}
      />
    </FormProvider>
  );

  // Headless: the footer registers with the parent drawer wrapper (always
  // called, per the rules of hooks; null registers nothing).
  useRegisterDrawerFooter(props.headless ? footerElement : null);

  const formBodyContent = (
    <FormProvider {...methods}>
      <VStack as="form" gap={4} align="stretch" flex={1} overflowY="auto">
        <Box
          borderBottomWidth="1px"
          borderColor="border"
          paddingX={4}
          paddingY={3}
          position="sticky"
          top={0}
          zIndex={2}
          // Solid, so messages scrolling underneath never show through.
          bg="bg"
          data-testid="prompt-editor-sticky-header"
        >
          <PromptEditorHeader
            onSave={() => void save.handleSave()}
            hasUnsavedChanges={hasUnsavedChanges}
            isValid={isValid}
            isSaving={save.isSaving}
            onVersionRestore={save.handleVersionRestore}
            variant="model-only"
          />
        </Box>

        <EditorDialogs save={save} nextVersion={nextVersion} storedPrompt={promptQuery.data} />

        <Box paddingX={4}>
          <PromptMessagesField
            messageFields={messageFields}
            availableFields={availableFields}
            otherNodesFields={{}}
            availableSources={availableSources}
            onSetVariableMapping={handleSetVariableMapping}
          />
        </Box>

        <Box paddingX={4}>
          <FormVariablesSection
            title="Variables"
            showMappings={hasSources}
            availableSources={availableSources}
            mappings={inputMappings}
            onMappingChange={onInputMappingsChange}
            missingMappingIds={missingMappingIds}
            showMissingMappingsError={!props.headless}
            variableInfo={{
              input:
                "This is the user message input. It will be sent as the user message to the LLM.",
            }}
          />
        </Box>

        {/* The outputs the model popover edits, surfaced so shaping a reply needs no popover. */}
        <Box paddingX={4} paddingBottom={4}>
          <FormOutputsSection />
        </Box>
      </VStack>
    </FormProvider>
  );

  const loadingContent =
    promptId && promptQuery.isLoading ? (
      <HStack justify="center" paddingY={8}>
        <Spinner size="md" />
      </HStack>
    ) : null;

  if (props.headless) return loadingContent ?? formBodyContent;

  // A version badge only when pinned to a version (from an experiment), not "latest".
  const versionBadge = promptVersionId && currentVersion !== undefined && (
    <VersionBadge
      version={currentVersion}
      latestVersion={latestVersion}
      onUpgrade={isOutdated ? save.handleUpgradeToLatest : undefined}
    />
  );

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="sm"
      modal={false}
    >
      <Drawer.Content bg="bg">
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
            <EditorTitle
              handle={promptId ? (promptQuery.data?.handle ?? undefined) : undefined}
              onRename={save.changeHandleDialog.openDialog}
              versionBadge={versionBadge}
              hasUnsavedChanges={hasUnsavedChanges}
            />
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {loadingContent ?? formBodyContent}
        </Drawer.Body>

        <Drawer.Footer borderTopWidth="1px" borderColor="border" paddingX={4} paddingY={3}>
          {footerElement}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
