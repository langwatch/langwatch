import {
  Box,
  Button,
  Circle,
  Field,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import debounce from "lodash-es/debounce";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

import DynamicZodForm from "~/components/checks/DynamicZodForm";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { toaster } from "~/components/ui/toaster";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
} from "~/components/variables";
import type { LocalEvaluatorConfig } from "~/evaluations-v3/types";
import {
  getComplexProps,
  getDrawerStack,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { WorkflowCardDisplay } from "~/optimization_studio/components/workflow/WorkflowCard";

import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";
import { EvaluatorMappingsSection } from "./EvaluatorMappingsSection";

export type EvaluatorMappingsConfig = {
  level?: "trace" | "thread";
  availableSources?: AvailableSource[];
  initialMappings: Record<string, UIFieldMapping>;
  onMappingChange?: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
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
  onMappingChange?: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
  initialLocalConfig?: LocalEvaluatorConfig;
};

type EvaluatorFormValues = {
  name: string;
  settings: Record<string, unknown>;
};

export type EvaluatorEditorController = {
  form: UseFormReturn<EvaluatorFormValues>;
  evaluatorId: string | undefined;
  evaluatorType: string | undefined;
  evaluatorDef:
    | (typeof AVAILABLE_EVALUATORS)[keyof typeof AVAILABLE_EVALUATORS]
    | undefined;
  effectiveEvaluatorDef:
    | { requiredFields?: string[]; optionalFields?: string[] }
    | undefined;
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
  onMappingChange:
    | ((identifier: string, mapping: UIFieldMapping | undefined) => void)
    | undefined;
  onLocalConfigChange:
    | ((config: LocalEvaluatorConfig | undefined) => void)
    | undefined;
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
  const utils = api.useContext();
  const { checkAndProceed } = useLicenseEnforcement("evaluators");

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
    props.mappingsConfig ??
    (complexProps.mappingsConfig as EvaluatorMappingsConfig | undefined);
  const onMappingChange = flowCallbacks?.onMappingChange;

  const saveButtonText =
    props.saveButtonText ?? (complexProps.saveButtonText as string | undefined);

  const onLocalConfigChange =
    props.onLocalConfigChange ?? flowCallbacks?.onLocalConfigChange;
  const initialLocalConfig =
    props.initialLocalConfig ??
    (complexProps.initialLocalConfig as LocalEvaluatorConfig | undefined);

  const { isOpen } = props;

  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: !!evaluatorId && !!project?.id && isOpen },
  );

  const isWorkflowEvaluator = evaluatorQuery.data?.type === "workflow";

  const loadedEvaluatorType = (
    evaluatorQuery.data?.config as { evaluatorType?: string } | null
  )?.evaluatorType;
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
      const requiredFields = fields
        .filter((f) => !f.optional)
        .map((f) => f.identifier);
      const optionalFields = fields
        .filter((f) => f.optional)
        .map((f) => f.identifier);
      return { requiredFields, optionalFields };
    }
    return evaluatorDef;
  }, [evaluatorQuery.data?.fields, evaluatorDef]);

  const settingsSchema = useMemo(() => {
    if (!evaluatorType) return undefined;
    return evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape
      ?.settings;
  }, [evaluatorType]);

  const defaultSettings = useMemo(() => {
    if (!evaluatorDef || !project) return {};
    return getEvaluatorDefaultSettings(evaluatorDef, project) ?? {};
  }, [evaluatorDef, project]);

  const forceUserToDecideAName =
    evaluatorType?.startsWith("langevals/llm_") &&
    evaluatorType !== "langevals/llm_answer_match"
      ? true
      : false;

  const form = useForm<EvaluatorFormValues>({
    defaultValues: {
      name: forceUserToDecideAName ? "" : (evaluatorDef?.name ?? ""),
      settings: defaultSettings,
    },
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (evaluatorDef && !evaluatorId) {
      form.reset({
        name: forceUserToDecideAName ? "" : evaluatorDef.name,
        settings: defaultSettings,
      });
    }
  }, [
    evaluatorDef,
    evaluatorId,
    defaultSettings,
    form,
    forceUserToDecideAName,
  ]);

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
          JSON.stringify(formValues.settings) !==
          JSON.stringify(saved.settings);
        isUnsaved = nameChanged || settingsChanged;
      } else {
        isUnsaved = true;
      }

      setHasUnsavedChanges(isUnsaved);

      if (onLocalConfigChangeRef.current) {
        if (isUnsaved) {
          debouncedUpdateLocalConfig({
            name: formValues.name ?? "",
            settings: formValues.settings as
              | Record<string, unknown>
              | undefined,
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
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error creating evaluator",
        description: error.message,
        type: "error",
      });
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
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error saving evaluator",
        description: error.message,
        type: "error",
      });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const name = form.watch("name");
  const isValid = !!name && name.trim().length > 0;

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
        const freshOnSave =
          getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
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
      checkAndProceed(() => {
        createMutation.mutate({
          projectId: project.id,
          name: formValues.name.trim(),
          type: "evaluator",
          config,
        });
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
    checkAndProceed,
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
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?",
        )
      ) {
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
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

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

export function EvaluatorEditorBody({
  controller,
}: {
  controller: EvaluatorEditorController;
}) {
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
  } = controller;

  if (evaluatorId && isLoadingEvaluator) {
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner size="md" />
      </HStack>
    );
  }

  return (
    <FormProvider {...form}>
      <VStack
        gap={4}
        align="stretch"
        flex={1}
        paddingX={6}
        paddingY={4}
        overflowY="auto"
      >
        {evaluatorDef?.description && (
          <Text fontSize="sm" color="fg.muted">
            {evaluatorDef.description}
          </Text>
        )}

        <Field.Root required>
          <Field.Label>Evaluator Name</Field.Label>
          <Input
            {...form.register("name")}
            placeholder="Enter evaluator name"
            data-testid="evaluator-name-input"
          />
        </Field.Root>

        {hasSettings && evaluatorType && settingsSchema && (
          <DynamicZodForm
            schema={settingsSchema}
            evaluatorType={evaluatorType as EvaluatorTypes}
            prefix="settings"
            errors={form.formState.errors.settings}
            variant="default"
          />
        )}

        {isWorkflowEvaluator && workflowCard && (
          <VStack gap={4} paddingTop={4} align="stretch">
            <Text fontSize="sm" color="fg.muted">
              This evaluator is powered by a workflow. Click below to open the
              workflow editor:
            </Text>
            <Link
              href={`/${projectSlug}/studio/${workflowCard.workflowId}`}
              data-testid="open-workflow-link"
              target="_blank"
            >
              <WorkflowCardDisplay
                name={workflowCard.workflowName ?? "Workflow"}
                icon={workflowCard.workflowIcon}
                updatedAt={workflowCard.updatedAt}
                action={
                  <ExternalLink
                    size={16}
                    color="var(--chakra-colors-fg-muted)"
                  />
                }
                width="300px"
              />
            </Link>
          </VStack>
        )}

        {!hasSettings &&
          (!mappingsConfig || !onMappingChange) &&
          !isWorkflowEvaluator && (
            <Text fontSize="sm" color="fg.muted">
              This evaluator does not have any settings to configure.
            </Text>
          )}

        {mappingsConfig && onMappingChange && (
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
  /**
   * Override the Cancel button behavior. When not provided, defaults to
   * controller.handleClose (which walks the drawer stack and confirms unsaved
   * changes). The unified flow passes a direct close so Cancel always shuts
   * the whole flow.
   */
  onCancel?: () => void;
};

export function EvaluatorEditorFooter({
  controller,
  onCancel,
}: EvaluatorEditorFooterProps) {
  const {
    evaluatorId,
    hasUnsavedChanges,
    isSaving,
    isValid,
    saveButtonText,
    onLocalConfigChange,
    handleSave,
    handleDiscard,
    handleApply,
    handleClose,
  } = controller;

  if (onLocalConfigChange) {
    return (
      <HStack width="full">
        {hasUnsavedChanges && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiscard}
            data-testid="evaluator-discard-button"
          >
            Discard
          </Button>
        )}
        <Spacer />
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={!isValid || isSaving}
          loading={isSaving}
          data-testid="evaluator-save-button"
        >
          Save
        </Button>
        <Button
          colorPalette="blue"
          size="sm"
          onClick={handleApply}
          data-testid="evaluator-apply-button"
        >
          Apply
        </Button>
      </HStack>
    );
  }

  return (
    <HStack gap={3}>
      <Button variant="outline" onClick={onCancel ?? handleClose}>
        Cancel
      </Button>
      <Button
        colorPalette="green"
        onClick={handleSave}
        disabled={!isValid || isSaving}
        loading={isSaving}
        data-testid="save-evaluator-button"
      >
        {saveButtonText ??
          (evaluatorId ? "Save Changes" : "Create Evaluator")}
      </Button>
    </HStack>
  );
}

// ============================================================================
// Header title (renderable — for parents that want to show the unsaved badge)
// ============================================================================

export function EvaluatorEditorHeading({
  controller,
}: {
  controller: EvaluatorEditorController;
}) {
  const { title, hasUnsavedChanges, onLocalConfigChange } = controller;
  return (
    <>
      <Heading>{title}</Heading>
      {hasUnsavedChanges && onLocalConfigChange && (
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
  );
}
