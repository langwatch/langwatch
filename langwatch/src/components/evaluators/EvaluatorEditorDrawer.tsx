import {
  Button,
  Heading,
  HStack,
  Spinner,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { LuArrowLeft } from "react-icons/lu";
import { z } from "zod";
import { Drawer } from "~/components/ui/drawer";
import type {
  AvailableSource,
  FieldMapping as UIFieldMapping,
} from "~/components/variables";
import {
  getComplexProps,
  getDrawerStack,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
import { api } from "~/utils/api";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";
import { EvaluatorEditorContent } from "./EvaluatorEditorContent";

/**
 * Mapping configuration for showing evaluator input mappings.
 * This is provided by the caller (e.g., Evaluations V3, Optimization Studio)
 * to enable context-specific mapping UI without this component knowing the details.
 *
 * Two modes are supported:
 * 1. Online evaluation: provide `level` and the component fetches trace/thread sources
 * 2. Dataset evaluation: provide `availableSources` directly (e.g., dataset columns)
 */
export type EvaluatorMappingsConfig = {
  /**
   * For online evaluation: specify level and sources will be fetched automatically.
   * This avoids race conditions when the drawer opens before data loads.
   */
  level?: "trace" | "thread";
  /**
   * For dataset evaluation: provide sources directly (dataset columns, signature fields).
   * If both level and availableSources are provided, availableSources takes precedence.
   */
  availableSources?: AvailableSource[];
  /** Initial mappings in UI format - used to seed local state */
  initialMappings: Record<string, UIFieldMapping>;
  /** Callback when a mapping changes - used to persist to store */
  onMappingChange: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
};

export type EvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  /** Called when evaluator is saved. Return true to indicate navigation was handled. */
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | void | Promise<void> | Promise<boolean>;
  /** Evaluator type (e.g., "langevals/exact_match") */
  evaluatorType?: string;
  /** If provided, loads an existing evaluator for editing */
  evaluatorId?: string;
  /** Category for back navigation (informational only) */
  category?: EvaluatorCategoryId;
  /**
   * Optional mapping configuration for showing evaluator input mappings.
   * When provided, the drawer shows a mappings section.
   * The caller is responsible for providing sources, current mappings, and missing field IDs.
   */
  mappingsConfig?: EvaluatorMappingsConfig;
  /**
   * Optional custom text for the save button.
   * Useful for flows like Online Evaluation where we're "selecting" rather than "saving".
   */
  saveButtonText?: string;
};

/**
 * Drawer for creating/editing a built-in evaluator.
 * Shows a name input and settings based on the evaluator type's schema.
 */
export function EvaluatorEditorDrawer(props: EvaluatorEditorDrawerProps) {
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

  // Get evaluatorId from props, URL params, or complexProps
  const evaluatorId =
    props.evaluatorId ??
    drawerParams.evaluatorId ??
    (complexProps.evaluatorId as string | undefined);

  // Get mappingsConfig from props or complexProps
  const mappingsConfig =
    props.mappingsConfig ??
    (complexProps.mappingsConfig as EvaluatorMappingsConfig | undefined);

  // Get custom save button text from props or complexProps
  const saveButtonText =
    props.saveButtonText ?? (complexProps.saveButtonText as string | undefined);

  const isOpen = props.open !== false && props.open !== undefined;

  // Load existing evaluator if editing
  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: !!evaluatorId && !!project?.id && isOpen },
  );

  // Check if this is a workflow evaluator
  const isWorkflowEvaluator = evaluatorQuery.data?.type === "workflow";

  // Get evaluatorType from props, URL params, complexProps, or loaded evaluator data
  const loadedEvaluatorType = (
    evaluatorQuery.data?.config as { evaluatorType?: string } | null
  )?.evaluatorType;
  const evaluatorType =
    props.evaluatorType ??
    drawerParams.evaluatorType ??
    (complexProps.evaluatorType as string | undefined) ??
    loadedEvaluatorType;

  // Get evaluator definition
  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : undefined;

  // For workflow evaluators, construct a synthetic evaluator definition from the pre-computed fields
  // This allows the mappings section to work with workflow fields using the existing structure
  // For built-in evaluators, we also use the pre-computed fields from the backend
  const effectiveEvaluatorDef = useMemo(() => {
    const fields = evaluatorQuery.data?.fields;
    if (fields && fields.length > 0) {
      // Use pre-computed fields from the backend (works for both workflow and built-in evaluators)
      const requiredFields = fields
        .filter((f) => !f.optional)
        .map((f) => f.identifier);
      const optionalFields = fields
        .filter((f) => f.optional)
        .map((f) => f.identifier);
      return { requiredFields, optionalFields };
    }
    // Fallback to AVAILABLE_EVALUATORS for new evaluators not yet saved
    return evaluatorDef;
  }, [evaluatorQuery.data?.fields, evaluatorDef]);

  // Get the schema for this evaluator type
  const settingsSchema = useMemo(() => {
    if (!evaluatorType) return undefined;
    const schema =
      evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape?.settings;
    return schema;
  }, [evaluatorType]);

  // Get default settings
  const defaultSettings = useMemo(() => {
    if (!evaluatorDef || !project) return {};
    return getEvaluatorDefaultSettings(evaluatorDef, project) ?? {};
  }, [evaluatorDef, project]);

  // Check if this is an LLM as Judge evaluator (should not prefill name)
  const forceUserToDecideAName =
    evaluatorType?.startsWith("langevals/llm_") &&
    evaluatorType !== "langevals/llm_answer_match"
      ? true
      : false;

  // Form state using react-hook-form
  const form = useForm<{ name: string; settings: Record<string, unknown> }>({
    defaultValues: {
      name: forceUserToDecideAName ? "" : (evaluatorDef?.name ?? ""),
      settings: defaultSettings,
    },
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Update form defaults when evaluator type changes
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

  // Initialize form with evaluator data
  useEffect(() => {
    if (evaluatorQuery.data) {
      const config = evaluatorQuery.data.config as {
        settings?: Record<string, unknown>;
      } | null;
      form.reset({
        name: evaluatorQuery.data.name,
        settings: config?.settings ?? {},
      });
      setHasUnsavedChanges(false);
    }
  }, [evaluatorQuery.data, form]);

  // Track form changes
  useEffect(() => {
    const subscription = form.watch(() => setHasUnsavedChanges(true));
    return () => subscription.unsubscribe();
  }, [form]);

  // Mutations
  // IMPORTANT: Navigation after save is the CALLER'S responsibility!
  // If onSave callback is provided, it should handle navigation (return true to skip default).
  // Default behavior (goBack/onClose) is only for simple cases without custom callbacks.
  // Different callers have different needs:
  // - OnlineEvaluationDrawer: custom navigation back to online evaluation drawer
  // - EvaluationsV3: closes drawer after adding to workbench
  // - /evaluators page: should set up onSave callback to closeDrawer
  const createMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      // Get fresh callback from flow callbacks (might have been set after component rendered)
      const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
      // If onSave returns true, it handled navigation - don't do default navigation
      const handledNavigation = freshOnSave?.({
        id: evaluator.id,
        name: evaluator.name,
        evaluatorType, // Pass the evaluator type to the callback
      });
      if (handledNavigation) return;
      // Default: go back if there's a stack, otherwise close
      if (getDrawerStack().length > 1) {
        goBack();
      } else {
        onClose();
      }
    },
    onError: (error) => {
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
      // Get fresh callback from flow callbacks (might have been set after component rendered)
      const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
      // If onSave returns true, it handled navigation - don't do default navigation
      const handledNavigation = freshOnSave?.({
        id: evaluator.id,
        name: evaluator.name,
      });
      if (handledNavigation) return;
      // Default: go back if there's a stack, otherwise close
      if (getDrawerStack().length > 1) {
        goBack();
      } else {
        onClose();
      }
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const name = form.watch("name");
  const isValid = name?.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid) return;

    // For existing workflow evaluators, we're just "selecting" them, not saving
    // Call onSave directly without requiring evaluatorType
    if (evaluatorId && isWorkflowEvaluator) {
      const freshOnSave = getFlowCallbacks("evaluatorEditor")?.onSave ?? onSave;
      const handledNavigation = freshOnSave?.({
        id: evaluatorId,
        name: evaluatorQuery.data?.name ?? "",
      });
      if (handledNavigation) return;
      // Default: go back if there's a stack, otherwise close
      if (getDrawerStack().length > 1) {
        goBack();
      } else {
        onClose();
      }
      return;
    }

    // For built-in evaluators, we need evaluatorType
    if (!evaluatorType) return;

    const formValues = form.getValues();
    const config = {
      evaluatorType,
      settings: formValues.settings,
    };

    if (evaluatorId) {
      // Editing existing evaluator - no limit check needed
      updateMutation.mutate({
        id: evaluatorId,
        projectId: project.id,
        name: formValues.name.trim(),
        config,
      });
    } else {
      // Creating new evaluator - check license limit first
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

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?",
        )
      ) {
        return;
      }
    }
    // If there's a previous drawer in the stack, go back to it
    // Otherwise, close everything
    if (canGoBack) {
      goBack();
    } else {
      onClose();
    }
  };

  const hasSettings =
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

  // Build workflow metadata for the content component
  const workflow =
    isWorkflowEvaluator && evaluatorQuery.data?.workflowId
      ? {
          id: evaluatorQuery.data.workflowId,
          name: evaluatorQuery.data.workflowName ?? "Workflow",
          icon: evaluatorQuery.data.workflowIcon,
          updatedAt: evaluatorQuery.data.updatedAt,
          projectSlug: project?.slug ?? "",
        }
      : undefined;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
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
            <Heading>{evaluatorDef?.name ?? "Configure Evaluator"}</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          {evaluatorId && evaluatorQuery.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <EvaluatorEditorContent
              evaluatorType={evaluatorType}
              description={evaluatorDef?.description}
              isWorkflowEvaluator={isWorkflowEvaluator}
              workflow={workflow}
              form={form}
              settingsSchema={settingsSchema}
              hasSettings={hasSettings}
              effectiveEvaluatorDef={effectiveEvaluatorDef}
              mappingsConfig={mappingsConfig}
              variant="drawer"
            />
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
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
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
