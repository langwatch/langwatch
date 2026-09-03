import { Box, Field, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react";
import debounce from "lodash-es/debounce";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";

import DynamicZodForm from "../checks/dynamic-zod-form";
import { Link } from "@langwatch/workflow-web/studio-host/link";
import type {
  AvailableSource,
  FieldMapping as UIFieldMapping,
} from "@langwatch/prompt-web/surfaces/variables";

import { ComparisonConfigForm } from "@langwatch/experiment-web/experiments-v3/components/EvaluatorPanel/ComparisonConfigForm";
import type {
  ComparisonEvaluatorConfig,
  LocalEvaluatorConfig,
  TargetConfig,
} from "@langwatch/experiment-web/experiments-v3/types";
import { isComparisonEvaluatorType } from "@langwatch/experiment-web/experiments-v3/types";
import {
  applyHandledErrorToForm,
  FormServerError,
  showErrorToast,
} from "@langwatch/workflow-web/studio-host/errors";
import {
  getComplexProps,
  getDrawerStack,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/ui-host/use-drawer";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { WorkflowCardDisplay } from "@langwatch/workflow-web";
import { formatTimeAgo } from "@langwatch/workflow-web/utils/formatTimeAgo";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  evaluatorsSchema,
} from "@langwatch/evaluator-contract";
import { getEvaluatorDefaultSettings } from "@langwatch/evaluator-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL } from "@langwatch/workflow-web/utils/constants";

import {
  type EvaluatorCategoryId,
  EvaluatorEditorActions,
  EvaluatorEditorHeading as EvaluatorEditorHeadingPresentation,
} from "@langwatch/evaluator-web";
import { EvaluatorMappingsSection } from "../../elements/evaluators/evaluator-mappings-section";

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

export type EvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | void | Promise<void> | Promise<boolean>;
  evaluatorType?: string;
  evaluatorId?: string;
  category?: EvaluatorCategoryId;
  mappingsConfig?: EvaluatorMappingsConfig;
  saveButtonText?: string;
  onLocalConfigChange?: (config: LocalEvaluatorConfig | undefined) => void;
  onMappingChange?: (identifier: string, mapping: UIFieldMapping | undefined) => void;
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
        workflowName?: string;
        workflowIcon?: string;
        updatedAt: Date;
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

  const saveButtonText =
    props.saveButtonText ?? (complexProps.saveButtonText as string | undefined);

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

  const effectiveEvaluatorDef = useMemo(() => {
    const fields = evaluatorQuery.data?.fields;
    if (fields && fields.length > 0) {
      const requiredFields = fields.filter((f: any) => !f.optional).map((f: any) => f.identifier);
      const optionalFields = fields.filter((f: any) => f.optional).map((f: any) => f.identifier);
      return { requiredFields, optionalFields };
    }
    return evaluatorDef;
  }, [evaluatorQuery.data?.fields, evaluatorDef]);

  const settingsSchema = useMemo(() => {
    if (!evaluatorType) return undefined;
    return evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape?.settings;
  }, [evaluatorType]);

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

  const forceUserToDecideAName =
    evaluatorType?.startsWith("langevals/llm_") && evaluatorType !== "langevals/llm_answer_match"
      ? true
      : false;

  const form = useForm<EvaluatorFormValues>({
    defaultValues: {
      name: forceUserToDecideAName ? "" : (evaluatorDef?.name ?? ""),
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
      name: forceUserToDecideAName ? "" : evaluatorDef.name,
      settings: defaultSettings,
    });
    didInitializeCreateFormRef.current = key;
  }, [evaluatorDef, evaluatorId, evaluatorType, defaultSettings, form, forceUserToDecideAName]);

  const savedFormValuesRef = useRef<EvaluatorFormValues | null>(null);
  const onLocalConfigChangeRef = useRef(onLocalConfigChange);
  onLocalConfigChangeRef.current = onLocalConfigChange;
  const initializedForEvaluatorRef = useRef<string | null>(null);

  useEffect(() => {
    if (evaluatorQuery.data) {
      const config = evaluatorQuery.data.config as {
        settings?: Record<string, unknown>;
      } | null;
      const savedValues: EvaluatorFormValues = {
        name: evaluatorQuery.data.name,
        settings: config?.settings ?? {},
      };
      savedFormValuesRef.current = savedValues;

      // Only reset form on first data load for this evaluator, not on refetches
      if (initializedForEvaluatorRef.current !== evaluatorQuery.data.id) {
        initializedForEvaluatorRef.current = evaluatorQuery.data.id;
        const formValues: EvaluatorFormValues = initialLocalConfig
          ? {
              name: initialLocalConfig.name,
              settings: initialLocalConfig.settings ?? savedValues.settings,
            }
          : savedValues;

        form.reset(formValues);
        setHasUnsavedChanges(!!initialLocalConfig);
      }
    }
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
      const saved = savedFormValuesRef.current;
      let isUnsaved = false;

      if (saved) {
        const nameChanged = formValues.name?.trim() !== saved.name.trim();
        const settingsChanged =
          JSON.stringify(formValues.settings) !== JSON.stringify(saved.settings);
        isUnsaved = nameChanged || settingsChanged;
      } else {
        isUnsaved = true;
      }

      setHasUnsavedChanges(isUnsaved);

      if (onLocalConfigChangeRef.current) {
        if (isUnsaved) {
          debouncedUpdateLocalConfig({
            name: formValues.name ?? "",
            settings: formValues.settings as Record<string, unknown> | undefined,
          });
        } else {
          debouncedUpdateLocalConfig.cancel();
          onLocalConfigChangeRef.current(undefined);
        }
      }
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
      const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
      const handledNavigation = freshOnSave?.({
        id: evaluator.id,
        name: evaluator.name,
        evaluatorType,
      });
      if (handledNavigation) return;
      if (getDrawerStack().length > 1) {
        goBack();
      } else {
        onClose();
      }
    },
    onError: (error) => {
      if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
      showErrorToast({ error, fallbackTitle: "Couldn't create evaluator" });
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
      const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
      const handledNavigation = freshOnSave?.({
        id: evaluator.id,
        name: evaluator.name,
      });
      if (handledNavigation) return;
      if (getDrawerStack().length > 1) {
        goBack();
      } else {
        onClose();
      }
    },
    onError: (error) => {
      if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
      showErrorToast({ error, fallbackTitle: "Couldn't save evaluator" });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const name = form.watch("name");

  // A comparison with fewer than two variants judges nothing (the
  // orchestrator skips it), so gate Save/Apply on it. Filter empty slots,
  // not array length: a folded legacy pairwise config always returns a
  // 2-element array even with an unset slot.
  const hasEnoughVariants =
    !isComparisonEvaluatorType(evaluatorType) || comparison.variants.filter(Boolean).length >= 2;
  const isValid = !!name && name.trim().length > 0 && hasEnoughVariants;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid) return;

    // For existing workflow evaluators, persist name changes via mutation
    if (evaluatorId && isWorkflowEvaluator) {
      const formValues = form.getValues();
      const newName = formValues.name.trim();
      const nameChanged = newName !== (evaluatorQuery.data?.name?.trim() ?? "");

      if (nameChanged) {
        updateMutation.mutate({
          id: evaluatorId,
          projectId: project.id,
          name: newName,
        });
      } else {
        const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
        const handledNavigation = freshOnSave?.({
          id: evaluatorId,
          name: evaluatorQuery.data?.name ?? "",
        });
        if (handledNavigation) return;
        if (getDrawerStack().length > 1) {
          goBack();
        } else {
          onClose();
        }
      }
      return;
    }

    if (!evaluatorType) return;

    const formValues = form.getValues();
    const config = {
      evaluatorType,
      settings: formValues.settings,
    };

    if (evaluatorId) {
      updateMutation.mutate({
        id: evaluatorId,
        projectId: project.id,
        name: formValues.name.trim(),
        config,
      });
    } else {
      createMutation.mutate({
        projectId: project.id,
        name: formValues.name.trim(),
        type: "evaluator",
        config,
      });
    }
  }, [
    project?.id,
    evaluatorId,
    evaluatorType,
    isWorkflowEvaluator,
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
    if (hasUnsavedChanges) {
      if (onLocalConfigChange) {
        // Mirror handleApply: flush the trailing debounced update so the
        // parent gets the last edits before unmount cancels the pending call.
        debouncedUpdateLocalConfig.flush();
        onClose();
        return;
      }
      if (!window.confirm("You have unsaved changes. Are you sure you want to close?")) {
        return;
      }
    }
    if (canGoBack) {
      goBack();
    } else {
      onClose();
    }
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

  const hasSettings =
    settingsSchema instanceof z.ZodObject && Object.keys(settingsSchema.shape).length > 0;

  const title = evaluatorDef?.name ?? "Configure Evaluator";

  const workflowCard = evaluatorQuery.data?.workflowId
    ? {
        workflowId: evaluatorQuery.data.workflowId,
        workflowName: evaluatorQuery.data.workflowName,
        workflowIcon: evaluatorQuery.data.workflowIcon,
        updatedAt: evaluatorQuery.data.updatedAt,
      }
    : undefined;

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
    title,
    handleSave,
    handleClose,
    handleDiscard,
    handleApply,
    flushLocalConfig,
  };
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
                updatedAtLabel={formatTimeAgo(workflowCard.updatedAt.getTime())}
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
