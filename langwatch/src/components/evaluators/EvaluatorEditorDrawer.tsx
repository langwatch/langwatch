import {
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { useState, useCallback, useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.zod.generated";
import DynamicZodForm from "~/components/checks/DynamicZodForm";
import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
import type { EvaluatorCategoryId } from "./EvaluatorCategorySelectorDrawer";

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
    onClose();
  };

  const hasSettings =
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
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
            <Heading>
              {evaluatorDef?.name ?? "Configure Evaluator"}
            </Heading>
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
                  <Text fontSize="sm" color="gray.600">
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

                {!hasSettings && (
                  <Text fontSize="sm" color="gray.500">
                    This evaluator does not have any settings to configure.
                  </Text>
                )}
              </VStack>
            </FormProvider>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
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
