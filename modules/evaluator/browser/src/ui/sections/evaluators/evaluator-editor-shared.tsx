import { Box, Field, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import { applyHandledErrorToForm, showErrorToast } from "@langwatch/browser-host/errors";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Link } from "@langwatch/browser-host/link";
import {
  getComplexProps,
  getDrawerStack,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/browser-host/use-drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api, type RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import { Switch } from "@langwatch/design-system/switch";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  evaluatorSettingsSchemaFor,
  getEvaluatorDefaultSettings,
} from "@langwatch/evaluator-contract";
import { ComparisonConfigForm } from "@langwatch/experiment-browser/comparison-config-form";
import type {
  ComparisonEvaluatorConfig,
  LocalEvaluatorConfig,
  TargetConfig,
} from "@langwatch/experiment-contract";
import { isComparisonEvaluatorType } from "@langwatch/experiment-contract";
import { DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import type {
  AvailableSource,
  FieldMapping as UIFieldMapping,
} from "@langwatch/prompt-browser-kit";
import { toEpochMs } from "@langwatch/time";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  WorkflowCardDisplay,
  FormServerError,
} from "@langwatch/workflow-browser-kit";
import debounce from "lodash-es/debounce";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";

import { isPersistedEvaluatorType } from "../../../model/persisted-evaluator-type.ts";
import { type EvaluatorCategoryId } from "../../blocks/evaluator-category-picker.tsx";
import {
  EvaluatorEditorActions,
  EvaluatorEditorHeading as EvaluatorEditorHeadingPresentation,
} from "../../elements/evaluator-editor-chrome.tsx";
import { EvaluatorMappingsSection } from "../../elements/evaluators/evaluator-mappings-section.tsx";
import DynamicZodForm from "../checks/dynamic-zod-form.tsx";

// Stable module-level reference (not an inline JSX literal): ComparisonConfigForm
// re-syncs its draft whenever this `value` prop's REFERENCE changes, so a fresh
// `{...}` on every re-render would silently wipe the variants/Golden field.
const EMPTY_COMPARISON_CONFIG: ComparisonEvaluatorConfig = {
  variants: [],
  hasGoldenAnswer: false,
  goldenField: "",
  includeMetrics: [],
  randomizeOrder: true,
};

export type EvaluatorMappingsConfig = {
  level?: "trace" | "thread";
  availableSources?: AvailableSource[];
  initialMappings: Record<string, UIFieldMapping>;
  onMappingChange?: (identifier: string, mapping: UIFieldMapping | undefined) => void;
};

/**
 * Whether a failing result of this evaluator fails what it is attached
 * to. A pass/fail evaluator can be required; a score-only evaluator
 * reports but never gates, so its switch stays off and disabled.
 */
export type EvaluatorGateConfig = {
  required: boolean;
  canRequire: boolean;
};

export const REQUIRED_TO_PASS_LABEL = "Required to pass";
export const REQUIRED_TO_PASS_COPY =
  "A failing required evaluator fails the scenario. An unrequired one reports its result beside the verdict.";
export const SCORE_ONLY_COPY = "Scores report, they do not gate.";

export type EvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | undefined | Promise<void> | Promise<boolean>;
  evaluatorType?: string;
  evaluatorId?: string;
  category?: EvaluatorCategoryId;
  mappingsConfig?: EvaluatorMappingsConfig;
  saveButtonText?: string;
  onLocalConfigChange?: (config: LocalEvaluatorConfig | undefined) => void;
  onMappingChange?: (identifier: string, mapping: UIFieldMapping | undefined) => void;
  /**
   * The gate of the attachment this evaluator is opened for. Present only
   * when the evaluator is attached to something that runs it after each
   * scenario, which is where a required pass or fail means anything.
   */
  gate?: EvaluatorGateConfig;
  /** Called when the required switch is flipped. Flows through setFlowCallbacks. */
  onRequiredChange?: (required: boolean) => void;
  /** Called when the attachment is taken off. Flows through setFlowCallbacks. */
  onRemove?: () => void;
  initialLocalConfig?: LocalEvaluatorConfig;
  /**
   * Comparison drawer context. Non-serializable; flows through complexProps.
   * When present, the drawer renders ComparisonConfigForm in place of the
   * per-row mappings section.
   */
  comparisonContext?: {
    initialComparison?: ComparisonEvaluatorConfig;
    targets: { id: string }[];
    datasetColumns: { id: string; name: string }[];
    /** Active dataset's name, used only to qualify column labels as
     * "Test Data.expected_output" — matching the mapping chips elsewhere. */
    datasetName?: string;
  };
};

type EvaluatorFormValues = {
  name: string;
  settings: Record<string, unknown>;
};

export type EvaluatorEditorController = {
  form: UseFormReturn<EvaluatorFormValues>;
  evaluatorId: string | undefined;
  evaluatorType: string | undefined;
  evaluatorDef: (typeof AVAILABLE_EVALUATORS)[keyof typeof AVAILABLE_EVALUATORS] | undefined;
  effectiveEvaluatorDef: { requiredFields?: string[]; optionalFields?: string[] } | undefined;
  isLoadingEvaluator: boolean;
  workflowCard:
    | {
        workflowId: string;
        workflowName?: string | undefined;
        workflowIcon?: string | undefined;
        updatedAt: string;
      }
    | undefined;
  isWorkflowEvaluator: boolean;
  hasSettings: boolean;
  settingsSchema: z.ZodTypeAny | undefined;
  projectSlug: string | undefined;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isValid: boolean;
  saveButtonText: string | undefined;
  mappingsConfig: EvaluatorMappingsConfig | undefined;
  onMappingChange: ((identifier: string, mapping: UIFieldMapping | undefined) => void) | undefined;
  /** Comparison drawer context. Set only for comparison evaluator types. */
  comparisonContext:
    | {
        initialComparison?: ComparisonEvaluatorConfig;
        targets: TargetConfig[];
        datasetColumns: { id: string; name: string }[];
        datasetName?: string;
      }
    | undefined;
  /**
   * Whether a `comparisonContext` is expected, i.e. the workbench opened it.
   * False for openers with no workbench behind them, which never attach one.
   */
  expectsComparisonContext: boolean;
  /** The live comparison draft, mirrored from ComparisonConfigForm. */
  comparison: ComparisonEvaluatorConfig;
  onComparisonChange: ((config: ComparisonEvaluatorConfig) => void) | undefined;
  onLocalConfigChange: ((config: LocalEvaluatorConfig | undefined) => void) | undefined;
  /** The gate of the attachment, when the editor is open on one. */
  gate: EvaluatorGateConfig | undefined;
  /** Whether the attachment is required right now, as the switch shows it. */
  required: boolean;
  onRequiredChange: ((required: boolean) => void) | undefined;
  onRemove: (() => void) | undefined;
  title: string;
  handleSave: () => void;
  handleClose: () => void;
  handleDiscard: () => void;
  handleApply: () => void;
  flushLocalConfig: () => void;
};

/**
 * Owns all state/behavior for the evaluator editor. Consumers render the
 * returned controller via <EvaluatorEditorBody/> and <EvaluatorEditorFooter/>.
 */
export function useEvaluatorEditorController(
  props: EvaluatorEditorDrawerProps & { isOpen: boolean },
): EvaluatorEditorController {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useUtils();

  const onClose = props.onClose ?? closeDrawer;
  const flowCallbacks = getFlowCallbacks("evaluatorEditor");
  const onSave =
    props.onSave ??
    flowCallbacks?.onSave ??
    (complexProps.onSave as EvaluatorEditorDrawerProps["onSave"]);

  const evaluatorId =
    props.evaluatorId ??
    drawerParams.evaluatorId ??
    (complexProps.evaluatorId as string | undefined);

  const mappingsConfig =
    props.mappingsConfig ?? (complexProps.mappingsConfig as EvaluatorMappingsConfig | undefined);
  const onMappingChange = flowCallbacks?.onMappingChange;
  const { comparisonContext, comparison, handleComparisonChange, onComparisonChange } =
    useComparisonDraft({
      complexProps,
      flowCallbacks,
    });

  const saveButtonText =
    props.saveButtonText ?? (complexProps.saveButtonText as string | undefined);

  const gate = props.gate ?? (complexProps.gate as EvaluatorGateConfig | undefined);
  const onRequiredChange = props.onRequiredChange ?? flowCallbacks?.onRequiredChange;
  const onRemove = props.onRemove ?? flowCallbacks?.onRemove;
  const { required, handleRequiredChange } = useRequiredToggle({
    gateRequired: gate?.required,
    onRequiredChange,
  });

  const onLocalConfigChange = props.onLocalConfigChange ?? flowCallbacks?.onLocalConfigChange;
  const initialLocalConfig =
    props.initialLocalConfig ??
    (complexProps.initialLocalConfig as LocalEvaluatorConfig | undefined);

  const { isOpen } = props;

  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: !!evaluatorId && !!project?.id && isOpen },
  );

  const isWorkflowEvaluator = evaluatorQuery.data?.type === "workflow";
  const isPersistedEvaluator = isPersistedEvaluatorType(evaluatorQuery.data?.type);

  const loadedEvaluatorType = (evaluatorQuery.data?.config as { evaluatorType?: string } | null)
    ?.evaluatorType;
  const evaluatorType =
    props.evaluatorType ??
    drawerParams.evaluatorType ??
    (complexProps.evaluatorType as string | undefined) ??
    loadedEvaluatorType;

  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : undefined;

  const effectiveEvaluatorDef = useMemo(
    () => effectiveFieldsOf(evaluatorQuery.data?.fields, evaluatorDef),
    [evaluatorQuery.data?.fields, evaluatorDef],
  );

  const settingsSchema = useMemo(() => settingsSchemaOf(evaluatorType), [evaluatorType]);

  const defaultSettings = useResolvedDefaultSettings({ evaluatorDef, project, isOpen });

  const forceUserToDecideAName = mustChooseName(evaluatorType);

  const form = useForm<EvaluatorFormValues>({
    defaultValues: {
      name: defaultNameFor(evaluatorDef, forceUserToDecideAName),
      settings: defaultSettings,
    },
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // `defaultSettings` can resolve (new reference) after the user has already
  // started filling the form; `form.formState.isDirty` doesn't survive that
  // race reliably. Latch a ref so late-resolving defaults never re-fire the
  // reset once the form is live.
  const didInitializeCreateFormRef = useRef<string | null>(null);
  useEffect(() => {
    if (!evaluatorDef || evaluatorId) return;
    const key = evaluatorType ?? evaluatorDef.name ?? "unknown";
    if (didInitializeCreateFormRef.current === key) return;
    form.reset({
      name: defaultNameFor(evaluatorDef, forceUserToDecideAName),
      settings: defaultSettings,
    });
    didInitializeCreateFormRef.current = key;
  }, [evaluatorDef, evaluatorId, evaluatorType, defaultSettings, form, forceUserToDecideAName]);

  const savedFormValuesRef = useRef<EvaluatorFormValues | null>(null);
  const onLocalConfigChangeRef = useRef(onLocalConfigChange);
  onLocalConfigChangeRef.current = onLocalConfigChange;
  const initializedForEvaluatorRef = useRef<string | null>(null);

  useEffect(() => {
    const evaluator = evaluatorQuery.data;
    if (!evaluator) return;
    const savedValues = savedValuesOf(evaluator);
    savedFormValuesRef.current = savedValues;
    // Only reset form on first data load for this evaluator, not on refetches
    if (initializedForEvaluatorRef.current === evaluator.id) return;
    initializedForEvaluatorRef.current = evaluator.id;
    form.reset(openingValues(savedValues, initialLocalConfig));
    setHasUnsavedChanges(!!initialLocalConfig);
  }, [evaluatorQuery.data, form, initialLocalConfig]);

  const debouncedUpdateLocalConfig = useMemo(
    () =>
      debounce(
        (config: LocalEvaluatorConfig | undefined) => {
          onLocalConfigChangeRef.current?.(config);
        },
        300,
        { leading: true },
      ),
    [],
  );

  useEffect(() => {
    const subscription = form.watch((formValues) => {
      const isUnsaved = differsFromSaved(formValues, savedFormValuesRef.current);
      setHasUnsavedChanges(isUnsaved);
      const onLocalConfigChange = onLocalConfigChangeRef.current;
      if (!onLocalConfigChange) return;
      if (isUnsaved) {
        debouncedUpdateLocalConfig({
          name: formValues.name ?? "",
          settings: formValues.settings as Record<string, unknown> | undefined,
        });
        return;
      }
      debouncedUpdateLocalConfig.cancel();
      onLocalConfigChange(undefined);
    });

    return () => {
      subscription.unsubscribe();
      debouncedUpdateLocalConfig.cancel();
    };
  }, [form, debouncedUpdateLocalConfig]);

  const createMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      onLocalConfigChangeRef.current?.(undefined);
      navigateAfterSave({
        saved: { id: evaluator.id, name: evaluator.name, evaluatorType },
        onSave,
        goBack,
        onClose,
      });
    },
    onError: (error) => {
      reportSaveError({ error, form, fallbackTitle: "Couldn't create evaluator" });
    },
  });

  const updateMutation = api.evaluators.update.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.evaluators.getById.invalidate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
      onLocalConfigChangeRef.current?.(undefined);
      const config = evaluator.config as {
        settings?: Record<string, unknown>;
      } | null;
      savedFormValuesRef.current = {
        name: evaluator.name,
        settings: config?.settings ?? {},
      };
      setHasUnsavedChanges(false);
      navigateAfterSave({
        saved: { id: evaluator.id, name: evaluator.name },
        onSave,
        goBack,
        onClose,
      });
    },
    onError: (error) => {
      reportSaveError({ error, form, fallbackTitle: "Couldn't save evaluator" });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const name = form.watch("name");

  // A comparison with fewer than two variants judges nothing (the
  // orchestrator skips it), so gate Save/Apply on it. Filter empty slots,
  // not array length: a folded legacy pairwise config always returns a
  // 2-element array even with an unset slot.
  const isValid = isEditorValid({ name, evaluatorType, comparison });

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid) return;
    submitEvaluator({
      projectId: project.id,
      evaluatorId,
      evaluatorType,
      isPersistedEvaluator,
      values: form.getValues(),
      savedName: evaluatorQuery.data?.name,
      create: createMutation.mutate,
      update: updateMutation.mutate,
      afterUnchanged: (saved) => navigateAfterSave({ saved, onSave, goBack, onClose }),
    });
  }, [
    project?.id,
    evaluatorId,
    evaluatorType,
    isPersistedEvaluator,
    isValid,
    form,
    createMutation,
    updateMutation,
    onSave,
    onClose,
    goBack,
    evaluatorQuery.data?.name,
  ]);

  const handleClose = useCallback(() => {
    closeEditor({
      hasUnsavedChanges,
      keepsDraft: !!onLocalConfigChange,
      flushDraft: () => debouncedUpdateLocalConfig.flush(),
      canGoBack,
      goBack,
      onClose,
    });
  }, [
    hasUnsavedChanges,
    onLocalConfigChange,
    canGoBack,
    goBack,
    onClose,
    debouncedUpdateLocalConfig,
  ]);

  const handleDiscard = useCallback(() => {
    if (savedFormValuesRef.current) {
      debouncedUpdateLocalConfig.cancel();
      form.reset(savedFormValuesRef.current);
      setHasUnsavedChanges(false);
      onLocalConfigChange?.(undefined);
    }
  }, [form, onLocalConfigChange, debouncedUpdateLocalConfig]);

  // Flush the trailing debounced update so the parent sees the latest form
  // state before we close. Without this, a keystroke within 300ms of Apply
  // is dropped — the drawer closes while the trailing call is still queued.
  const handleApply = useCallback(() => {
    debouncedUpdateLocalConfig.flush();
    onClose();
  }, [debouncedUpdateLocalConfig, onClose]);

  // Exposed so callers that navigate away without invoking handleClose (e.g.
  // the unified drawer's Back/step transitions) can still ensure pending
  // edits reach the parent before the controller unmounts.
  const flushLocalConfig = useCallback(() => {
    debouncedUpdateLocalConfig.flush();
  }, [debouncedUpdateLocalConfig]);

  const hasSettings = hasSettingsFields(settingsSchema);

  const title = evaluatorDef?.name ?? evaluatorQuery.data?.name ?? "Configure Evaluator";

  const workflowCard = workflowCardOf(evaluatorQuery.data);

  return {
    form,
    evaluatorId,
    evaluatorType,
    evaluatorDef,
    effectiveEvaluatorDef,
    isLoadingEvaluator: evaluatorQuery.isLoading,
    workflowCard,
    isWorkflowEvaluator,
    hasSettings,
    settingsSchema,
    projectSlug: project?.slug,
    hasUnsavedChanges,
    isSaving,
    isValid,
    saveButtonText,
    mappingsConfig,
    onMappingChange,
    comparisonContext,
    // Only the workbench carries a targetId, so it's the signal that a
    // comparisonContext is on its way — see the field's docs.
    expectsComparisonContext: !!drawerParams.targetId,
    comparison,
    onComparisonChange: onComparisonChange ? handleComparisonChange : undefined,
    onLocalConfigChange,
    gate,
    required,
    onRequiredChange: onRequiredChange ? handleRequiredChange : undefined,
    onRemove,
    title,
    handleSave,
    handleClose,
    handleDiscard,
    handleApply,
    flushLocalConfig,
  };
}

/**
 * Whether a failing result fails the scenario. Shown under the mappings when
 * the editor is open on an attachment, so the gate is set where the inputs
 * are, and a score only evaluator says why it cannot gate.
 */
export function EvaluatorGateSection({
  gate,
  required,
  onRequiredChange,
}: {
  gate: EvaluatorGateConfig;
  required: boolean;
  onRequiredChange: ((required: boolean) => void) | undefined;
}) {
  const checked = gate.canRequire && required;
  return (
    <HStack align="flex-start" gap={3} paddingTop={4} data-testid="evaluator-gate-section">
      <VStack align="stretch" gap={0.5} flex={1} minWidth={0}>
        <Text fontSize="sm" fontWeight="medium">
          {REQUIRED_TO_PASS_LABEL}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {gate.canRequire ? REQUIRED_TO_PASS_COPY : SCORE_ONLY_COPY}
        </Text>
      </VStack>
      <Switch
        checked={checked}
        disabled={!gate.canRequire || !onRequiredChange}
        onCheckedChange={({ checked: next }) => onRequiredChange?.(next)}
        aria-label={REQUIRED_TO_PASS_LABEL}
        inputProps={{ "data-testid": "evaluator-required-switch" }}
      />
    </HStack>
  );
}

// ============================================================================
// Body
// ============================================================================

export function EvaluatorEditorBody({ controller }: { controller: EvaluatorEditorController }) {
  const {
    form,
    evaluatorId,
    evaluatorType,
    evaluatorDef,
    effectiveEvaluatorDef,
    isLoadingEvaluator,
    workflowCard,
    isWorkflowEvaluator,
    hasSettings,
    settingsSchema,
    projectSlug,
    mappingsConfig,
    onMappingChange,
    comparisonContext,
    expectsComparisonContext,
    comparison,
    onComparisonChange,
    gate,
    required,
    onRequiredChange,
  } = controller;

  // Comparison: render the variants+golden picker instead of the generic
  // mappings UI. Derived from evaluatorType alone so it's correct even when
  // drawer transitions wipe flowCallbacks/complexProps mid-flight.
  const isComparison = isComparisonEvaluatorType(evaluatorType);

  if (evaluatorId && isLoadingEvaluator) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner size="md" />
      </HStack>
    );
  }

  // A comparison editor needs its context to render the picker. On reload it
  // re-attaches a beat late, so hold the form to avoid a two-stage pop-in —
  // but only when `expectsComparisonContext` says it's actually coming
  // (non-workbench openers never attach one, so waiting there is forever).
  if (isComparison && !comparisonContext && expectsComparisonContext) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner size="md" />
      </HStack>
    );
  }

  return (
    <FormProvider {...form}>
      <VStack gap={4} align="stretch" flex={1} paddingX={6} paddingY={4} overflowY="auto">
        <FormServerError form={form} />

        {evaluatorDef?.description && (
          <Text fontSize="sm" color="fg.muted">
            {evaluatorDef.description}
          </Text>
        )}

        <Field.Root required invalid={!!form.formState.errors.name}>
          <Field.Label>Evaluator Name</Field.Label>
          <Input
            {...form.register("name")}
            placeholder="Enter evaluator name"
            data-testid="evaluator-name-input"
          />
          <Field.ErrorText>{form.formState.errors.name?.message}</Field.ErrorText>
        </Field.Root>

        {hasSettings && evaluatorType && settingsSchema && (
          <DynamicZodForm
            schema={settingsSchema}
            evaluatorType={evaluatorType as EvaluatorTypes}
            prefix="settings"
            errors={form.formState.errors.settings}
            variant="default"
            // Comparison shortcut: skip fields ComparisonConfigForm already
            // owns plus noise beside it. Everything else (model, max_tokens,
            // prompt, temperature, swap_and_reconcile) still renders here.
            skipFields={
              isComparison
                ? [
                    "swap_and_confirm",
                    "randomize_order",
                    "allow_tie",
                    "has_golden_answer",
                    "include_metrics",
                  ]
                : undefined
            }
          />
        )}

        {isWorkflowEvaluator && workflowCard && (
          <VStack gap={4} paddingTop={4} align="stretch">
            <Text fontSize="sm" color="fg.muted">
              This evaluator is powered by a workflow. Click below to open the workflow editor:
            </Text>
            <Link
              href={`/${projectSlug}/studio/${workflowCard.workflowId}`}
              data-testid="open-workflow-link"
              target="_blank"
            >
              <WorkflowCardDisplay
                name={workflowCard.workflowName ?? "Workflow"}
                icon={workflowCard.workflowIcon}
                updatedAtLabel={formatTimeAgo(toEpochMs(workflowCard.updatedAt))}
                action={<ExternalLink size={16} color="var(--chakra-colors-fg-muted)" />}
                width="300px"
              />
            </Link>
          </VStack>
        )}

        {!hasSettings &&
          !isComparison &&
          (!mappingsConfig || !onMappingChange) &&
          !isWorkflowEvaluator && (
            <Text fontSize="sm" color="fg.muted">
              This evaluator does not have any settings to configure.
            </Text>
          )}

        {isComparison && comparisonContext && onComparisonChange && (
          <Box paddingTop={4}>
            <ComparisonConfigForm
              value={comparison}
              onChange={onComparisonChange}
              targets={comparisonContext.targets}
              datasetColumns={comparisonContext.datasetColumns}
              datasetName={comparisonContext.datasetName}
            />
          </Box>
        )}

        {!isComparison && mappingsConfig && onMappingChange && (
          <Box paddingTop={4}>
            <EvaluatorMappingsSection
              evaluatorDef={effectiveEvaluatorDef}
              level={mappingsConfig.level}
              providedSources={mappingsConfig.availableSources}
              initialMappings={mappingsConfig.initialMappings}
              onMappingChange={onMappingChange}
              scrollToMissingOnMount={true}
            />
          </Box>
        )}

        {gate && (
          <EvaluatorGateSection
            gate={gate}
            required={required}
            onRequiredChange={onRequiredChange}
          />
        )}
      </VStack>
    </FormProvider>
  );
}

// ============================================================================
// Footer
// ============================================================================

export type EvaluatorEditorFooterProps = {
  controller: EvaluatorEditorController;
  /** Overrides Cancel; default `controller.handleClose` confirms unsaved changes. */
  onCancel?: () => void;
};

export function EvaluatorEditorFooter({ controller, onCancel }: EvaluatorEditorFooterProps) {
  const {
    evaluatorId,
    hasUnsavedChanges,
    isSaving,
    isValid,
    saveButtonText,
    onLocalConfigChange,
    onComparisonChange,
    onRemove,
    handleSave,
    handleDiscard,
    handleApply,
    handleClose,
  } = controller;

  return (
    <EvaluatorEditorActions
      mode={onLocalConfigChange ? "local" : "persisted"}
      isEditing={!!evaluatorId}
      hasUnsavedChanges={hasUnsavedChanges}
      isSaving={isSaving}
      isValid={isValid}
      isComparisonEditor={!!onComparisonChange}
      saveButtonText={saveButtonText}
      onSave={handleSave}
      onDiscard={handleDiscard}
      onApply={handleApply}
      onCancel={onCancel ?? handleClose}
      onRemove={onRemove}
    />
  );
}

// ============================================================================
// Header title (renderable — for parents that want to show the unsaved badge)
// ============================================================================

export function EvaluatorEditorHeading({ controller }: { controller: EvaluatorEditorController }) {
  const { title, hasUnsavedChanges, onLocalConfigChange } = controller;
  return (
    <EvaluatorEditorHeadingPresentation
      title={title}
      showUnpublishedBadge={hasUnsavedChanges && !!onLocalConfigChange}
    />
  );
}

function differsFromSaved(
  formValues: { name?: string; settings?: unknown },
  saved: EvaluatorFormValues | null,
): boolean {
  if (!saved) return true;
  const nameChanged = formValues.name?.trim() !== saved.name.trim();
  return nameChanged || JSON.stringify(formValues.settings) !== JSON.stringify(saved.settings);
}

function useComparisonDraft({
  complexProps,
  flowCallbacks,
}: {
  complexProps: ReturnType<typeof getComplexProps>;
  flowCallbacks: ReturnType<typeof getFlowCallbacks>;
}) {
  // Comparison: when this context is set, the drawer renders
  // ComparisonConfigForm instead of the per-row mappings section.
  const comparisonContext = complexProps.comparisonContext as
    | {
        initialComparison?: ComparisonEvaluatorConfig;
        targets: TargetConfig[];
        datasetColumns: { id: string; name: string }[];
        datasetName?: string;
      }
    | undefined;
  const onComparisonChange = (
    flowCallbacks as
      | {
          onComparisonChange?: (config: ComparisonEvaluatorConfig) => void;
        }
      | undefined
  )?.onComparisonChange;

  // ComparisonConfigForm keeps its own draft and only pushes changes outward,
  // so the editor has to mirror it here — otherwise the footer can't know
  // whether enough variants are picked to enable Save.
  const [comparison, setComparison] = useState<ComparisonEvaluatorConfig>(
    comparisonContext?.initialComparison ?? EMPTY_COMPARISON_CONFIG,
  );
  const initialComparison = comparisonContext?.initialComparison;
  useEffect(() => {
    setComparison(initialComparison ?? EMPTY_COMPARISON_CONFIG);
  }, [initialComparison]);

  const handleComparisonChange = useCallback(
    (next: ComparisonEvaluatorConfig) => {
      setComparison(next);
      onComparisonChange?.(next);
    },
    [onComparisonChange],
  );
  return { comparisonContext, comparison, handleComparisonChange, onComparisonChange };
}

function useRequiredToggle({
  gateRequired,
  onRequiredChange,
}: {
  gateRequired: boolean | undefined;
  onRequiredChange: ((required: boolean) => void) | undefined;
}) {
  // The switch flips right away; the attachment follows through the callback.
  const [required, setRequired] = useState(gateRequired ?? false);
  useEffect(() => {
    setRequired(gateRequired ?? false);
  }, [gateRequired]);
  const handleRequiredChange = useCallback(
    (next: boolean) => {
      setRequired(next);
      onRequiredChange?.(next);
    },
    [onRequiredChange],
  );
  return { required, handleRequiredChange };
}

/** The evaluator's defaults, preferring the models this project actually has configured. */
function useResolvedDefaultSettings({
  evaluatorDef,
  project,
  isOpen,
}: {
  evaluatorDef: Parameters<typeof getEvaluatorDefaultSettings>[0];
  project: { id: string } | undefined;
  isOpen: boolean;
}) {
  // Pull the cascade-resolved defaults so the form's initial model /
  // embeddings_model values reflect what this project actually has
  // configured (claude-opus, gemini-pro, etc.) instead of the generic
  // DEFAULT_MODEL constant baked into the evaluator zod schemas.
  const resolvedDefaultModel = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id && isOpen },
  );
  const resolvedDefaultEmbeddings = api.modelProvider.getResolvedDefault.useQuery(
    {
      projectId: project?.id ?? "",
      featureKey: "analytics.topic_clustering_embeddings",
    },
    { enabled: !!project?.id && isOpen },
  );

  const defaultSettings = useMemo(() => {
    if (!evaluatorDef || !project) return {};
    return (
      getEvaluatorDefaultSettings(
        evaluatorDef,
        {
          defaultModel: resolvedDefaultModel.data?.model ?? null,
          embeddingsModel: resolvedDefaultEmbeddings.data?.model ?? null,
        },
        {
          defaultModel: DEFAULT_MODEL,
          embeddingsModel: DEFAULT_EMBEDDINGS_MODEL,
        },
      ) ?? {}
    );
  }, [
    evaluatorDef,
    project,
    resolvedDefaultModel.data?.model,
    resolvedDefaultEmbeddings.data?.model,
  ]);
  return defaultSettings;
}

/** A flow callback that handled navigation wins; otherwise step back, or close the last drawer. */
function navigateAfterSave({
  saved,
  onSave,
  goBack,
  onClose,
}: {
  saved: { id: string; name: string; evaluatorType?: string };
  onSave: EvaluatorEditorDrawerProps["onSave"];
  goBack: () => void;
  onClose: () => void;
}) {
  const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
  if (freshOnSave?.(saved)) return;
  if (getDrawerStack().length > 1) {
    goBack();
  } else {
    onClose();
  }
}

/** A comparison with fewer than two variants judges nothing, so it cannot be saved. */
function isEditorValid({
  name,
  evaluatorType,
  comparison,
}: {
  name: string | undefined;
  evaluatorType: string | undefined;
  comparison: ComparisonEvaluatorConfig;
}): boolean {
  const hasEnoughVariants =
    !isComparisonEvaluatorType(evaluatorType) || comparison.variants.filter(Boolean).length >= 2;
  return !!name && name.trim().length > 0 && hasEnoughVariants;
}

function workflowCardOf(
  evaluator: RouterOutputs["evaluators"]["getById"] | undefined,
): EvaluatorEditorController["workflowCard"] {
  if (!evaluator?.workflowId) return undefined;
  return {
    workflowId: evaluator.workflowId,
    workflowName: evaluator.workflowName,
    workflowIcon: evaluator.workflowIcon,
    updatedAt: evaluator.updatedAt,
  };
}

type EvaluatorMutate<Input> = (input: Input) => void;

/**
 * A persisted evaluator only renames (or just navigates when unchanged); any other evaluator is
 * created or updated with its settings.
 */
function submitEvaluator({
  projectId,
  evaluatorId,
  evaluatorType,
  isPersistedEvaluator,
  values,
  savedName,
  create,
  update,
  afterUnchanged,
}: {
  projectId: string;
  evaluatorId: string | undefined;
  evaluatorType: string | undefined;
  isPersistedEvaluator: boolean;
  values: EvaluatorFormValues;
  savedName: string | undefined;
  create: EvaluatorMutate<{
    projectId: string;
    name: string;
    type: "evaluator";
    config: { evaluatorType: string; settings: Record<string, unknown> };
  }>;
  update: EvaluatorMutate<{
    id: string;
    projectId: string;
    name: string;
    config?: { evaluatorType: string; settings: Record<string, unknown> };
  }>;
  afterUnchanged: (saved: { id: string; name: string }) => void;
}) {
  const name = values.name.trim();
  if (evaluatorId && isPersistedEvaluator) {
    if (name !== (savedName?.trim() ?? "")) {
      update({ id: evaluatorId, projectId, name });
    } else {
      afterUnchanged({ id: evaluatorId, name: savedName ?? "" });
    }
    return;
  }
  if (!evaluatorType) return;
  const config = { evaluatorType, settings: values.settings };
  if (evaluatorId) {
    update({ id: evaluatorId, projectId, name, config });
  } else {
    create({ projectId, name, type: "evaluator", config });
  }
}

/** A drawer holding a draft flushes it and closes; otherwise unsaved edits ask first. */
function closeEditor({
  hasUnsavedChanges,
  keepsDraft,
  flushDraft,
  canGoBack,
  goBack,
  onClose,
}: {
  hasUnsavedChanges: boolean;
  keepsDraft: boolean;
  flushDraft: () => void;
  canGoBack: boolean;
  goBack: () => void;
  onClose: () => void;
}) {
  if (hasUnsavedChanges && keepsDraft) {
    flushDraft();
    onClose();
    return;
  }
  if (
    hasUnsavedChanges &&
    !window.confirm("You have unsaved changes. Are you sure you want to close?")
  ) {
    return;
  }
  if (canGoBack) {
    goBack();
  } else {
    onClose();
  }
}

function effectiveFieldsOf(
  fields: { identifier: string; optional?: boolean }[] | undefined,
  evaluatorDef: { requiredFields: string[]; optionalFields: string[] } | undefined,
) {
  if (!fields || fields.length === 0) return evaluatorDef;
  return {
    requiredFields: fields.filter((f) => !f.optional).map((f) => f.identifier),
    optionalFields: fields.filter((f) => f.optional).map((f) => f.identifier),
  };
}

function savedValuesOf(evaluator: { name: string; config: unknown }): EvaluatorFormValues {
  const config = evaluator.config as { settings?: Record<string, unknown> } | null;
  return { name: evaluator.name, settings: config?.settings ?? {} };
}

/** A local draft the caller kept wins over the saved evaluator. */
function openingValues(
  savedValues: EvaluatorFormValues,
  initialLocalConfig: LocalEvaluatorConfig | undefined,
): EvaluatorFormValues {
  if (!initialLocalConfig) return savedValues;
  return {
    name: initialLocalConfig.name,
    settings: initialLocalConfig.settings ?? savedValues.settings,
  };
}

function settingsSchemaOf(evaluatorType: string | undefined) {
  if (!evaluatorType) return undefined;
  const lookup = evaluatorSettingsSchemaFor(evaluatorType);
  return lookup.found ? lookup.schema : undefined;
}

function hasSettingsFields(settingsSchema: unknown): boolean {
  return settingsSchema instanceof z.ZodObject && Object.keys(settingsSchema.shape).length > 0;
}

/** LLM-judged evaluators (bar answer-match) make the user name the check themselves. */
function mustChooseName(evaluatorType: string | undefined): boolean {
  return Boolean(
    evaluatorType?.startsWith("langevals/llm_") && evaluatorType !== "langevals/llm_answer_match",
  );
}

function defaultNameFor(evaluatorDef: { name: string } | undefined, mustChoose: boolean): string {
  return mustChoose ? "" : (evaluatorDef?.name ?? "");
}

function reportSaveError({
  error,
  form,
  fallbackTitle,
}: {
  error: unknown;
  form: Parameters<typeof applyHandledErrorToForm>[0]["form"];
  fallbackTitle: string;
}) {
  if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
  showErrorToast({ error, fallbackTitle });
}
