import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { LuArrowLeft } from "react-icons/lu";
import { z } from "zod";
import DynamicZodForm from "~/components/checks/DynamicZodForm";
import { Drawer } from "~/components/ui/drawer";
import {
  type AvailableSource,
  type FieldMapping as UIFieldMapping,
  VariablesSection,
} from "~/components/variables";
import { getComplexProps, useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
import { api } from "~/utils/api";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";

/**
 * Mapping configuration for showing evaluator input mappings.
 * This is provided by the caller (e.g., Evaluations V3, Optimization Studio)
 * to enable context-specific mapping UI without this component knowing the details.
 */
export type EvaluatorMappingsConfig = {
  /** Available sources for variable mapping */
  availableSources: AvailableSource[];
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
  onSave?: (evaluator: { id: string; name: string }) => void;
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

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
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

  const isOpen = props.open !== false && props.open !== undefined;

  // Load existing evaluator if editing
  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: !!evaluatorId && !!project?.id && isOpen },
  );

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

  // Form state using react-hook-form
  const form = useForm<{ name: string; settings: Record<string, unknown> }>({
    defaultValues: {
      name: evaluatorDef?.name ?? "",
      settings: defaultSettings,
    },
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Update form defaults when evaluator type changes
  useEffect(() => {
    if (evaluatorDef && !evaluatorId) {
      form.reset({
        name: evaluatorDef.name,
        settings: defaultSettings,
      });
    }
  }, [evaluatorDef, evaluatorId, defaultSettings, form]);

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
  const createMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.({ id: evaluator.id, name: evaluator.name });
      onClose();
    },
  });

  const updateMutation = api.evaluators.update.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.evaluators.getById.invalidate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
      onSave?.({ id: evaluator.id, name: evaluator.name });
      onClose();
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const name = form.watch("name");
  const isValid = name?.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid || !evaluatorType) return;

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
    isValid,
    form,
    createMutation,
    updateMutation,
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

                {!hasSettings && !mappingsConfig && (
                  <Text fontSize="sm" color="fg.muted">
                    This evaluator does not have any settings to configure.
                  </Text>
                )}

                {/* Mappings section - shown when caller provides mappingsConfig */}
                {mappingsConfig &&
                  mappingsConfig.availableSources.length > 0 && (
                    <Box paddingTop={4}>
                      <EvaluatorMappingsSection
                        evaluatorDef={evaluatorDef}
                        availableSources={mappingsConfig.availableSources}
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
              {evaluatorId ? "Save Changes" : "Create Evaluator"}
            </Button>
          </HStack>
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
  availableSources: AvailableSource[];
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
 */
function EvaluatorMappingsSection({
  evaluatorDef,
  availableSources,
  initialMappings,
  onMappingChange,
  scrollToMissingOnMount = false,
}: EvaluatorMappingsSectionProps) {
  // Local state for mappings - source of truth for UI
  const [localMappings, setLocalMappings] =
    useState<Record<string, UIFieldMapping>>(initialMappings);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);

  // Sync from props when they change (e.g., dataset switch causing drawer to get new props)
  useEffect(() => {
    setLocalMappings(initialMappings);
  }, [initialMappings]);

  // Compute missingMappingIds REACTIVELY from local state
  // Uses same logic as getEvaluatorMissingMappings in mappingValidation.ts
  const missingMappingIds = useMemo(() => {
    const requiredFields = evaluatorDef?.requiredFields ?? [];
    const optionalFields = evaluatorDef?.optionalFields ?? [];
    const allFields = [...requiredFields, ...optionalFields];

    const missing = new Set<string>();

    // Check if ANY field has a valid mapping
    let hasAnyMapping = false;
    for (const field of allFields) {
      const mapping = localMappings[field];
      if (
        mapping &&
        (mapping.type === "value" ||
          (mapping.type === "source" && mapping.path.length > 0))
      ) {
        hasAnyMapping = true;
        break;
      }
    }

    // Required fields that are missing
    for (const field of requiredFields) {
      const mapping = localMappings[field];
      // A mapping is missing if undefined or if it's a source mapping with no field selected
      if (!mapping || (mapping.type === "source" && mapping.path.length === 0)) {
        missing.add(field);
      }
    }

    // Special case: if ALL fields are empty and there are no required fields,
    // highlight the first field to indicate something is needed
    if (!hasAnyMapping && requiredFields.length === 0 && allFields.length > 0) {
      missing.add(allFields[0]!);
    }

    return missing;
  }, [
    evaluatorDef?.requiredFields,
    evaluatorDef?.optionalFields,
    localMappings,
  ]);

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
      {/* Red validation message for pending mappings */}
      {missingMappingIds.size > 0 && (
        <Text
          data-testid="pending-mappings-error"
          color="red.500"
          fontSize="sm"
          marginTop={3}
        >
          Please map all required fields: {Array.from(missingMappingIds).join(", ")}
        </Text>
      )}
    </Box>
  );
}
