import {
  Box,
  Button,
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
import { FormProvider, useForm } from "react-hook-form";
import { LuArrowLeft } from "react-icons/lu";
import { Link } from "~/components/ui/link";
import { WorkflowCardDisplay } from "~/optimization_studio/components/workflow/WorkflowCard";
import { z } from "zod";
import DynamicZodForm from "~/components/checks/DynamicZodForm";
import { Drawer } from "~/components/ui/drawer";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
  VariablesSection,
} from "~/components/variables";
import type { LocalEvaluatorConfig } from "~/evaluations-v3/types";
import { validateEvaluatorMappingsWithFields } from "~/evaluations-v3/utils/mappingValidation";
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
import { useProjectSpanNames } from "~/hooks/useProjectSpanNames";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import {
  getTraceAvailableSources,
  getThreadAvailableSources,
} from "~/server/tracer/tracesMapping";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
import { api } from "~/utils/api";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";

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
  /**
   * For evaluations context: callback to persist local changes when closing without save.
   * If provided, closing with unsaved changes will NOT show a confirmation dialog.
   * Pass undefined to clear local changes (when form matches saved state).
   */
  onLocalConfigChange?: (config: LocalEvaluatorConfig | undefined) => void;
  /**
   * Initial local config to load (for resuming unpublished changes).
   * When provided, overrides DB data for form initialization.
   */
  initialLocalConfig?: LocalEvaluatorConfig;
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

  // Get local config callbacks from props or flow callbacks
  const onLocalConfigChange =
    props.onLocalConfigChange ?? flowCallbacks?.onLocalConfigChange;
  const initialLocalConfig =
    props.initialLocalConfig ??
    (complexProps.initialLocalConfig as LocalEvaluatorConfig | undefined);

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

  // Ref to track the saved (DB) form values for comparison with current form values.
  // Used by the debounced watch to determine if local changes differ from saved state.
  const savedFormValuesRef = useRef<{
    name: string;
    settings: Record<string, unknown>;
  } | null>(null);
  const onLocalConfigChangeRef = useRef(onLocalConfigChange);
  onLocalConfigChangeRef.current = onLocalConfigChange;

  // Initialize form with evaluator data (merging local config if present)
  useEffect(() => {
    if (evaluatorQuery.data) {
      const config = evaluatorQuery.data.config as {
        settings?: Record<string, unknown>;
      } | null;
      const savedValues = {
        name: evaluatorQuery.data.name,
        settings: config?.settings ?? {},
      };
      savedFormValuesRef.current = savedValues;

      // Merge local config over DB data if present
      const formValues = initialLocalConfig
        ? {
            name: initialLocalConfig.name,
            settings: initialLocalConfig.settings ?? savedValues.settings,
          }
        : savedValues;

      form.reset(formValues);
      setHasUnsavedChanges(!!initialLocalConfig);
    }
  }, [evaluatorQuery.data, form, initialLocalConfig]);

  // Debounced function to update local config (avoids flooding store on every keystroke)
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

  // Watch form changes, track unsaved state, and persist local config
  useEffect(() => {
    const subscription = form.watch((formValues) => {
      // Determine if form differs from saved DB state
      const saved = savedFormValuesRef.current;
      let isUnsaved = false;

      if (saved) {
        const nameChanged = formValues.name?.trim() !== saved.name.trim();
        const settingsChanged =
          JSON.stringify(formValues.settings) !==
          JSON.stringify(saved.settings);
        isUnsaved = nameChanged || settingsChanged;
      } else {
        // No saved state yet (new evaluator or still loading)
        isUnsaved = true;
      }

      setHasUnsavedChanges(isUnsaved);

      // Persist local config if callback is provided
      if (onLocalConfigChangeRef.current) {
        if (isUnsaved) {
          debouncedUpdateLocalConfig({
            name: formValues.name ?? "",
            settings: formValues.settings as
              | Record<string, unknown>
              | undefined,
          });
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
  }, [form, debouncedUpdateLocalConfig]);

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
      // Clear local config on successful save
      onLocalConfigChangeRef.current?.(undefined);
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
      // Clear local config on successful save
      onLocalConfigChangeRef.current?.(undefined);
      // Update saved values ref so form watch correctly detects no unsaved changes
      const config = evaluator.config as {
        settings?: Record<string, unknown>;
      } | null;
      savedFormValuesRef.current = {
        name: evaluator.name,
        settings: config?.settings ?? {},
      };
      setHasUnsavedChanges(false);
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
      // If onLocalConfigChange is provided (evaluations context), just close.
      // Local config is already being updated on every change.
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
    // If there's a previous drawer in the stack, go back to it
    // Otherwise, close everything
    if (canGoBack) {
      goBack();
    } else {
      onClose();
    }
  };

  const handleDiscard = useCallback(() => {
    if (savedFormValuesRef.current) {
      debouncedUpdateLocalConfig.cancel();
      form.reset(savedFormValuesRef.current);
      setHasUnsavedChanges(false);
      onLocalConfigChange?.(undefined);
    }
  }, [form, onLocalConfigChange, debouncedUpdateLocalConfig]);

  const hasSettings =
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

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
            <FormProvider {...form}>
              <VStack
                gap={4}
                align="stretch"
                flex={1}
                paddingX={6}
                paddingY={4}
                overflowY="auto"
              >
                {/* Description */}
                {evaluatorDef?.description && (
                  <Text fontSize="sm" color="fg.muted">
                    {evaluatorDef.description}
                  </Text>
                )}

                {/* Name field */}
                <Field.Root required>
                  <Field.Label>Evaluator Name</Field.Label>
                  <Input
                    {...form.register("name")}
                    placeholder="Enter evaluator name"
                    data-testid="evaluator-name-input"
                  />
                </Field.Root>

                {/* Settings fields using DynamicZodForm */}
                {hasSettings && evaluatorType && (
                  <DynamicZodForm
                    schema={settingsSchema}
                    evaluatorType={evaluatorType as EvaluatorTypes}
                    prefix="settings"
                    errors={form.formState.errors.settings}
                    variant="default"
                  />
                )}

                {/* Workflow card - always shown for workflow evaluators */}
                {isWorkflowEvaluator && evaluatorQuery.data?.workflowId && (
                  <VStack gap={4} paddingTop={4} align="stretch">
                    <Text fontSize="sm" color="fg.muted">
                      This evaluator is powered by a workflow. Click below to
                      open the workflow editor:
                    </Text>
                    <Link
                      href={`/${project?.slug}/studio/${evaluatorQuery.data.workflowId}`}
                      data-testid="open-workflow-link"
                      target="_blank"
                    >
                      <WorkflowCardDisplay
                        name={evaluatorQuery.data.workflowName ?? "Workflow"}
                        icon={evaluatorQuery.data.workflowIcon}
                        updatedAt={evaluatorQuery.data.updatedAt}
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

                {/* No settings message - only for non-workflow evaluators with no settings and no mappings */}
                {!hasSettings && !mappingsConfig && !isWorkflowEvaluator && (
                  <Text fontSize="sm" color="fg.muted">
                    This evaluator does not have any settings to configure.
                  </Text>
                )}

                {/* Mappings section - shown when caller provides mappingsConfig */}
                {mappingsConfig && (
                  <Box paddingTop={4}>
                    <EvaluatorMappingsSection
                      evaluatorDef={effectiveEvaluatorDef}
                      level={mappingsConfig.level}
                      providedSources={mappingsConfig.availableSources}
                      initialMappings={mappingsConfig.initialMappings}
                      onMappingChange={mappingsConfig.onMappingChange}
                      scrollToMissingOnMount={true}
                    />
                  </Box>
                )}
              </VStack>
            </FormProvider>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          {onLocalConfigChange ? (
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
                disabled={!isValid}
                loading={isSaving}
                data-testid="evaluator-save-button"
              >
                Save
              </Button>
              <Button
                colorPalette="blue"
                size="sm"
                onClick={onClose}
                data-testid="evaluator-apply-button"
              >
                Apply
              </Button>
            </HStack>
          ) : (
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
          )}
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Evaluator Mappings Section
// ============================================================================

type EvaluatorMappingsSectionProps = {
  evaluatorDef:
    | {
        requiredFields?: string[];
        optionalFields?: string[];
      }
    | undefined;
  /**
   * For online evaluation: specify level and sources will be fetched automatically.
   */
  level?: "trace" | "thread";
  /**
   * For dataset evaluation: provide sources directly.
   * If provided, takes precedence over level-based fetching.
   */
  providedSources?: AvailableSource[];
  /** Initial mappings - used to seed local state */
  initialMappings: Record<string, UIFieldMapping>;
  /** Callback to persist changes to store */
  onMappingChange: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
  /** Whether to scroll to the first missing mapping on mount */
  scrollToMissingOnMount?: boolean;
};

/**
 * Sub-component for evaluator input mappings.
 * Manages local state for immediate UI feedback, persists via onMappingChange.
 * Computes missingMappingIds reactively from local state.
 *
 * Supports two modes:
 * 1. Level-based: fetches span names/metadata keys internally (avoids race conditions)
 * 2. Provided sources: uses the sources passed directly (for dataset evaluations)
 */
function EvaluatorMappingsSection({
  evaluatorDef,
  level,
  providedSources,
  initialMappings,
  onMappingChange,
  scrollToMissingOnMount = false,
}: EvaluatorMappingsSectionProps) {
  const { project } = useOrganizationTeamProject();

  // Fetch span names and metadata keys for level-based mode
  // Only used when providedSources is not given
  const { spanNames, metadataKeys } = useProjectSpanNames(
    providedSources ? undefined : project?.id
  );

  // Build availableSources - use providedSources if given, otherwise fetch based on level
  const availableSources = useMemo(() => {
    // If sources are provided directly, use them (dataset evaluation mode)
    if (providedSources) {
      return providedSources;
    }
    // Otherwise, fetch based on level (online evaluation mode)
    if (level === "thread") {
      return getThreadAvailableSources() as AvailableSource[];
    }
    return getTraceAvailableSources(spanNames, metadataKeys) as AvailableSource[];
  }, [providedSources, level, spanNames, metadataKeys]);

  // Local state for mappings - source of truth for UI
  const [localMappings, setLocalMappings] =
    useState<Record<string, UIFieldMapping>>(initialMappings);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Sync from props when they change (e.g., dataset switch causing drawer to get new props)
  useEffect(() => {
    setLocalMappings(initialMappings);
  }, [initialMappings]);

  // Compute missingMappingIds REACTIVELY from local state using shared validation
  const missingMappingIds = useMemo(() => {
    const requiredFields = evaluatorDef?.requiredFields ?? [];
    const optionalFields = evaluatorDef?.optionalFields ?? [];
    const allFields = [...requiredFields, ...optionalFields];

    // Use the same shared validation logic as OnlineEvaluationDrawer
    const validation = validateEvaluatorMappingsWithFields(
      requiredFields,
      optionalFields,
      localMappings,
    );

    const missing = new Set<string>(validation.missingRequiredFields);

    // Special case: if ALL fields are empty and there are no required fields,
    // highlight the first field to indicate something is needed
    if (
      !validation.hasAnyMapping &&
      validation.missingRequiredFields.length === 0 &&
      allFields.length > 0
    ) {
      missing.add(allFields[0]!);
    }

    return missing;
  }, [evaluatorDef, localMappings]);

  // Scroll to first missing mapping on mount
  useEffect(() => {
    if (
      scrollToMissingOnMount &&
      !hasScrolledRef.current &&
      missingMappingIds.size > 0 &&
      containerRef.current
    ) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        const firstMissingId = Array.from(missingMappingIds)[0];
        const missingElement = containerRef.current?.querySelector(
          `[data-testid="missing-mapping-input"], [data-variable-id="${firstMissingId}"]`,
        );
        if (missingElement) {
          missingElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
          // Fallback: scroll to the container itself (mappings section)
          containerRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
        hasScrolledRef.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollToMissingOnMount, missingMappingIds]);

  // Handler that updates local state AND persists to store
  const handleMappingChange = useCallback(
    (identifier: string, mapping: UIFieldMapping | undefined) => {
      // Update local state immediately for responsive UI
      setLocalMappings((prev) => {
        const next = { ...prev };
        if (mapping) {
          next[identifier] = mapping;
        } else {
          delete next[identifier];
        }
        return next;
      });

      // Persist to store
      onMappingChange(identifier, mapping);
    },
    [onMappingChange],
  );

  // Build variables from evaluator definition's required/optional fields
  const variables = useMemo(() => {
    const allFields = [
      ...(evaluatorDef?.requiredFields ?? []),
      ...(evaluatorDef?.optionalFields ?? []),
    ];
    return allFields.map((field) => ({
      identifier: field,
      type: "str" as const,
    }));
  }, [evaluatorDef]);

  if (variables.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted">
        This evaluator does not require any input mappings.
      </Text>
    );
  }

  return (
    <Box ref={containerRef}>
      <VariablesSection
        title="Variables"
        variables={variables}
        // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op - evaluator inputs are read-only
        onChange={() => {}}
        showMappings={true}
        availableSources={availableSources}
        mappings={localMappings}
        onMappingChange={handleMappingChange}
        readOnly={true} // Can't add/remove evaluator inputs
        missingMappingIds={missingMappingIds}
      />
    </Box>
  );
}
