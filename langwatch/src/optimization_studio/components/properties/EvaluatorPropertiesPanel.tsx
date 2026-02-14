import { Button, HStack, Spacer, Spinner, VStack } from "@chakra-ui/react";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import { z } from "zod";
import DynamicZodForm from "../../../components/checks/DynamicZodForm";
import type { EvaluatorMappingsConfig } from "../../../components/evaluators/EvaluatorEditorDrawer";
import { EvaluatorEditorContent } from "../../../components/evaluators/EvaluatorEditorContent";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "../../../server/evaluations/getEvaluator";
import { api } from "../../../utils/api";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Evaluator, Field } from "../../types/dsl";
import {
  buildAvailableSources,
  buildInputMappingsFromEdges,
  applyMappingChangeToEdges,
} from "../../utils/edgeMappingUtils";
import { useRegisterDrawerFooter } from "../drawers/useInsideDrawer";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

/**
 * Checks whether the evaluator string uses the new DB-backed format (`evaluators/<id>`).
 */
function isDbEvaluatorRef(evaluator: string | undefined): boolean {
  return !!evaluator?.startsWith("evaluators/");
}

/**
 * Extracts the evaluator DB ID from a `evaluators/<id>` reference.
 */
function extractEvaluatorId(evaluator: string): string {
  return evaluator.replace("evaluators/", "");
}

/**
 * Properties panel for evaluator nodes in the optimization studio.
 *
 * Supports two formats:
 * - New format: `evaluators/<id>` -- fetches evaluator from DB, renders EvaluatorEditorContent
 * - Old format: direct type like `langevals/exact_match` -- inline DynamicZodForm (backward compat)
 */
export function EvaluatorPropertiesPanel({ node }: { node: Node<Evaluator> }) {
  const evaluator = node.data.evaluator;

  if (isDbEvaluatorRef(evaluator)) {
    return <DbEvaluatorPanel node={node} evaluatorRef={evaluator!} />;
  }

  return <InlineEvaluatorPanel node={node} />;
}

// ---------------------------------------------------------------------------
// New format: DB-backed evaluator panel
// ---------------------------------------------------------------------------

function DbEvaluatorPanel({
  node,
  evaluatorRef,
}: {
  node: Node<Evaluator>;
  evaluatorRef: string;
}) {
  const { project } = useOrganizationTeamProject();
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodes, edges, setNode, setEdges, getWorkflow, deselectAllNodes } =
    useWorkflowStore(
      useShallow(
        ({ setNode, setEdges, getWorkflow, deselectAllNodes }) => ({
          nodes: getWorkflow().nodes,
          edges: getWorkflow().edges,
          setNode,
          setEdges,
          getWorkflow,
          deselectAllNodes,
        }),
      ),
    );
  const evaluatorId = extractEvaluatorId(evaluatorRef);

  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId, projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const updateMutation = api.evaluators.update.useMutation();

  const config = evaluatorQuery.data?.config as {
    evaluatorType?: string;
    settings?: Record<string, unknown>;
  } | null;

  const evaluatorType = config?.evaluatorType;
  const dbName = evaluatorQuery.data?.name ?? "";
  const dbSettings = config?.settings ?? {};

  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : undefined;

  const settingsSchema = useMemo(() => {
    if (!evaluatorType) return undefined;
    return evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape
      ?.settings;
  }, [evaluatorType]);

  const hasSettings =
    !!settingsSchema &&
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

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

  const isWorkflowEvaluator = evaluatorQuery.data?.type === "workflow";

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

  // Local config from node data (unsaved changes)
  const localConfig = node.data.localConfig;
  const initialName = localConfig?.name ?? dbName;
  const initialSettings = localConfig?.settings ?? dbSettings;

  // Form for name + settings
  const form = useForm<{ name: string; settings: Record<string, unknown> }>({
    defaultValues: {
      name: initialName,
      settings: initialSettings,
    },
  });

  // Reset form when evaluator data loads, respecting localConfig
  useEffect(() => {
    if (evaluatorQuery.data) {
      const lc = node.data.localConfig;
      form.reset({
        name: lc?.name ?? evaluatorQuery.data.name,
        settings:
          lc?.settings ??
          (evaluatorQuery.data.config as any)?.settings ??
          {},
      });
    }
  }, [evaluatorQuery.data, form]);

  // Watch form changes and persist to node.data.localConfig (debounced to
  // avoid flooding the store on every keystroke).
  // Only set localConfig when values actually differ from the saved state.
  const debouncedSetLocalConfig = useDebouncedCallback(
    (formValues: { name?: string; settings?: Record<string, unknown> }) => {
      const nameChanged = formValues.name !== dbName;
      const settingsChanged =
        JSON.stringify(formValues.settings) !== JSON.stringify(dbSettings);
      if (nameChanged || settingsChanged) {
        setNode({
          id: node.id,
          data: {
            localConfig: {
              name: formValues.name as string,
              settings: formValues.settings as Record<string, unknown>,
            },
          },
        });
      } else {
        // Form matches saved state — clear any local config
        setNode({ id: node.id, data: { localConfig: undefined } });
      }
    },
    300,
    { trailing: true },
  );

  useEffect(() => {
    const subscription = form.watch((formValues) => {
      if (formValues.name !== undefined && formValues.settings !== undefined) {
        debouncedSetLocalConfig(formValues);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, debouncedSetLocalConfig]);

  // Build mappingsConfig from workflow graph
  const availableSources = useMemo(
    () => buildAvailableSources({ nodeId: node.id, nodes, edges }),
    [edges, nodes, node.id],
  );

  const inputMappings = useMemo(
    () => buildInputMappingsFromEdges({ nodeId: node.id, edges }),
    [edges, node.id],
  );

  const handleInputMappingChange = useCallback(
    (identifier: string, mapping: any) => {
      const currentEdges = getWorkflow().edges;
      const newEdges = applyMappingChangeToEdges({
        nodeId: node.id,
        identifier,
        mapping,
        currentEdges,
      });
      setEdges(newEdges);
      updateNodeInternals(node.id);
    },
    [getWorkflow, node.id, setEdges, updateNodeInternals],
  );

  const mappingsConfig: EvaluatorMappingsConfig = useMemo(
    () => ({
      availableSources,
      initialMappings: inputMappings,
      onMappingChange: handleInputMappingChange,
    }),
    [availableSources, inputMappings, handleInputMappingChange],
  );

  // Action handlers
  const handleApply = useCallback(
    () => deselectAllNodes(),
    [deselectAllNodes],
  );

  const handleSave = useCallback(() => {
    if (!project?.id || !evaluatorType) return;
    const formValues = form.getValues();
    updateMutation.mutate(
      {
        id: evaluatorId,
        projectId: project.id,
        name: formValues.name.trim(),
        config: {
          evaluatorType,
          settings: formValues.settings,
        },
      },
      {
        onSuccess: () =>
          setNode({ id: node.id, data: { localConfig: undefined } }),
      },
    );
  }, [
    project?.id,
    evaluatorId,
    evaluatorType,
    form,
    updateMutation,
    setNode,
    node.id,
  ]);

  const handleDiscard = useCallback(() => {
    debouncedSetLocalConfig.cancel();
    form.reset({ name: dbName, settings: dbSettings });
    setNode({ id: node.id, data: { localConfig: undefined } });
  }, [form, dbName, dbSettings, setNode, node.id, debouncedSetLocalConfig]);

  const hasLocalChanges = !!localConfig;

  // Register footer with the drawer wrapper
  const footerContent = useMemo(
    () => (
      <HStack width="full">
        {hasLocalChanges && (
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
          onClick={handleApply}
          data-testid="evaluator-apply-button"
        >
          Apply
        </Button>
        <Button
          colorPalette="blue"
          size="sm"
          onClick={handleSave}
          loading={updateMutation.isPending}
          data-testid="evaluator-save-button"
        >
          Save
        </Button>
      </HStack>
    ),
    [hasLocalChanges, handleDiscard, handleApply, handleSave, updateMutation.isPending],
  );
  useRegisterDrawerFooter(footerContent);

  if (evaluatorQuery.isLoading) {
    return (
      <HStack justify="center" paddingY={8} width="full">
        <Spinner size="md" />
      </HStack>
    );
  }

  return (
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
      variant="studio"
    />
  );
}

// ---------------------------------------------------------------------------
// Old format: inline evaluator panel (backward compatibility)
// ---------------------------------------------------------------------------

function InlineEvaluatorPanel({ node }: { node: Node<Evaluator> }) {
  const { project } = useOrganizationTeamProject();
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const settingsFromParameters = Object.fromEntries(
    (node.data.parameters ?? []).map(({ identifier, value }) => [
      identifier,
      value,
    ]),
  );
  const form = useForm({
    defaultValues: {
      settings: settingsFromParameters,
    },
  });

  const evaluator = node.data.evaluator;

  const schema =
    evaluator && evaluator in AVAILABLE_EVALUATORS
      ? evaluatorsSchema.shape[evaluator as EvaluatorTypes]?.shape.settings
      : undefined;

  const availableEvaluators = useAvailableEvaluators();

  useEffect(() => {
    if (
      !evaluator ||
      !availableEvaluators ||
      !(evaluator in availableEvaluators)
    )
      return;
    if (node.data.parameters) return;

    const evaluatorDefinition =
      availableEvaluators[evaluator as EvaluatorTypes];

    const setDefaultSettings = (
      defaultValues: Record<string, any>,
      prefix: string,
    ) => {
      if (!defaultValues) return;

      Object.entries(defaultValues).forEach(([key, value]) => {
        if (
          typeof value === "object" &&
          !Array.isArray(value) &&
          value !== null
        ) {
          setDefaultSettings(value, `${prefix}.${key}`);
        } else {
          //@ts-ignore
          form.setValue(`${prefix}.${key}`, value);
        }
      });
    };

    setDefaultSettings(
      getEvaluatorDefaultSettings(evaluatorDefinition, project),
      "settings",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluator]);

  const onSubmit = useCallback(
    (data: { settings: Record<string, any> }) => {
      setNode({
        id: node.id,
        data: {
          parameters: Object.entries(data.settings).map(
            ([identifier, value]) =>
              ({
                identifier,
                type: "str",
                value: value,
              }) as Field,
          ),
        },
      });
    },
    [node.id, setNode],
  );

  const handleSubmit_ = useCallback(() => {
    void form.handleSubmit(onSubmit)();
  }, [form, onSubmit]);

  const handleSubmitDebounced = useDebouncedCallback(handleSubmit_, 100, {
    leading: true,
    trailing: false,
  });

  useEffect(() => {
    const subscription = form.watch(() => {
      handleSubmitDebounced();
    });

    return () => subscription.unsubscribe();
  }, [form, handleSubmitDebounced]);

  const hasEvaluatorFields =
    evaluator &&
    schema instanceof z.ZodObject &&
    Object.keys(schema.shape).length > 0;

  return (
    <BasePropertiesPanel node={node} hideParameters={!!hasEvaluatorFields}>
      {hasEvaluatorFields && schema && (
        <FormProvider {...form}>
          <VStack width="full" gap={3}>
            <DynamicZodForm
              schema={schema}
              evaluatorType={evaluator as EvaluatorTypes}
              prefix="settings"
              errors={form.formState.errors.settings}
              variant="studio"
            />
          </VStack>
        </FormProvider>
      )}
    </BasePropertiesPanel>
  );
}

// ---------------------------------------------------------------------------
// Exported footer for use by StudioDrawerWrapper (wired in a later task)
// ---------------------------------------------------------------------------

/**
 * Reusable footer with Discard / Apply / Save buttons for evaluator drawers.
 *
 * Rendered outside the properties panel so it can be placed in a drawer footer
 * slot without interfering with the panel's inputs/outputs layout.
 */
export function EvaluatorDrawerFooter({
  onApply,
  onSave,
  onDiscard,
  isSaving,
}: {
  onApply: () => void;
  onSave: () => void;
  onDiscard: () => void;
  isSaving: boolean;
}) {
  return (
    <HStack width="full" paddingY={3} paddingX={4}>
      <Button
        variant="outline"
        size="sm"
        onClick={onDiscard}
        data-testid="evaluator-discard-button"
      >
        Discard
      </Button>
      <Spacer />
      <Button
        variant="outline"
        size="sm"
        onClick={onApply}
        data-testid="evaluator-apply-button"
      >
        Apply
      </Button>
      <Button
        colorPalette="blue"
        size="sm"
        onClick={onSave}
        loading={isSaving}
        data-testid="evaluator-save-button"
      >
        Save
      </Button>
    </HStack>
  );
}
