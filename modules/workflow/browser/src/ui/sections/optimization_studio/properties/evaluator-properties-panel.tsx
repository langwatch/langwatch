import { Button, HStack, Spacer, Spinner, VStack } from "@chakra-ui/react";
import { api, type RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import { useAvailableEvaluators } from "@langwatch/evaluator-browser/available-evaluators";
import DynamicZodForm from "@langwatch/evaluator-browser/dynamic-zod-form";
import { EvaluatorEditorContent } from "@langwatch/evaluator-browser/evaluator-editor-content";
import type { EvaluatorMappingsConfig } from "@langwatch/evaluator-browser/surfaces/evaluator-editor-shared";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  evaluatorsSchema,
  getEvaluatorDefaultSettings,
} from "@langwatch/evaluator-contract";
import { DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import { DEFAULT_EMBEDDINGS_MODEL, useRegisterDrawerFooter } from "@langwatch/workflow-browser-kit";
import type { Evaluator, Field } from "@langwatch/workflow-contract";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { z } from "zod";
import { useShallow } from "zustand/react/shallow";

import { useOrganizationTeamProject } from "../../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../../../model/edge-mapping.ts";
import { BasePropertiesPanel } from "./base-properties-panel.tsx";

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
 * Properties panel for evaluator nodes: `evaluators/<id>` fetches the
 * evaluator from the database, while an old direct type like
 * `langevals/exact_match` renders an inline DynamicZodForm.
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

type EvaluatorRecord = RouterOutputs["evaluators"]["getById"] | undefined;

function DbEvaluatorPanel({ node, evaluatorRef }: { node: Node<Evaluator>; evaluatorRef: string }) {
  const { project } = useOrganizationTeamProject();
  const evaluatorId = extractEvaluatorId(evaluatorRef);
  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId, projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  if (evaluatorQuery.isLoading) {
    return (
      <HStack justify="center" paddingY={8} width="full">
        <Spinner size="md" />
      </HStack>
    );
  }

  // A saved evaluator has a new updatedAt, which remounts the form onto it.
  return (
    <DbEvaluatorForm
      key={String(evaluatorQuery.data?.updatedAt ?? "")}
      node={node}
      evaluatorId={evaluatorId}
      evaluator={evaluatorQuery.data}
      refetchEvaluator={evaluatorQuery.refetch}
    />
  );
}

function DbEvaluatorForm({
  node,
  evaluatorId,
  evaluator,
  refetchEvaluator,
}: {
  node: Node<Evaluator>;
  evaluatorId: string;
  evaluator: EvaluatorRecord;
  refetchEvaluator: () => Promise<unknown>;
}) {
  const { project } = useOrganizationTeamProject();
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodes, edges, setNode, setEdges, getWorkflow, deselectAllNodes } = useWorkflowStore(
    useShallow(({ setNode, setEdges, getWorkflow, deselectAllNodes }) => ({
      nodes: getWorkflow().nodes,
      edges: getWorkflow().edges,
      setNode,
      setEdges,
      getWorkflow,
      deselectAllNodes,
    })),
  );
  const updateMutation = api.evaluators.update.useMutation();

  const config = evaluator?.config as {
    evaluatorType?: string;
    settings?: Record<string, unknown>;
  } | null;

  const evaluatorType = config?.evaluatorType;
  const dbName = evaluator?.name ?? "";
  const dbSettings = useMemo(() => config?.settings ?? {}, [config?.settings]);

  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : undefined;

  const settingsSchema = useMemo(() => {
    if (!evaluatorType) return undefined;
    return evaluatorsSchema.shape[evaluatorType as EvaluatorTypes]?.shape?.settings;
  }, [evaluatorType]);

  const hasSettings =
    !!settingsSchema &&
    settingsSchema instanceof z.ZodObject &&
    Object.keys(settingsSchema.shape).length > 0;

  const effectiveEvaluatorDef = useMemo(() => {
    const fields = evaluator?.fields;
    if (fields && fields.length > 0) {
      const requiredFields = fields.filter((f: any) => !f.optional).map((f: any) => f.identifier);
      const optionalFields = fields.filter((f: any) => f.optional).map((f: any) => f.identifier);
      return { requiredFields, optionalFields };
    }
    return evaluatorDef;
  }, [evaluator?.fields, evaluatorDef]);

  const isWorkflowEvaluator = evaluator?.type === "workflow";

  const workflow =
    isWorkflowEvaluator && evaluator?.workflowId
      ? {
          id: evaluator.workflowId,
          name: evaluator.workflowName ?? "Workflow",
          icon: evaluator.workflowIcon,
          updatedAt: evaluator.updatedAt,
          projectSlug: project?.slug ?? "",
        }
      : undefined;

  // Unsaved changes live on the node, so they win over the saved evaluator.
  const localConfig = node.data.localConfig;
  const form = useForm<{ name: string; settings: Record<string, unknown> }>({
    defaultValues: {
      name: localConfig?.name ?? dbName,
      settings: localConfig?.settings ?? dbSettings,
    },
  });

  // Watch form changes and persist to node.data.localConfig (debounced to
  // avoid flooding the store on every keystroke).
  // Only set localConfig when values actually differ from the saved state.
  const debouncedSetLocalConfig = useDebouncedCallback(
    (formValues: { name?: string; settings?: Record<string, unknown> }) => {
      const nameChanged = formValues.name !== dbName;
      const settingsChanged = JSON.stringify(formValues.settings) !== JSON.stringify(dbSettings);
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
    () =>
      buildInputMappings({
        nodeId: node.id,
        edges,
        inputs: node.data.inputs ?? [],
      }),
    [edges, node.id, node.data.inputs],
  );

  const handleInputMappingChange = useCallback(
    (identifier: string, mapping: any) => {
      const workflow = getWorkflow();
      const currentInputs = workflow.nodes.find((n) => n.id === node.id)?.data.inputs ?? [];
      const result = applyMappingChange({
        nodeId: node.id,
        identifier,
        mapping,
        currentEdges: workflow.edges,
        currentInputs,
      });
      setEdges(result.edges);
      setNode({ id: node.id, data: { inputs: result.inputs } });
      updateNodeInternals(node.id);
    },
    [getWorkflow, node.id, setEdges, setNode, updateNodeInternals],
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
  const handleApply = useCallback(() => deselectAllNodes(), [deselectAllNodes]);

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
        onSuccess: () => {
          setNode({ id: node.id, data: { localConfig: undefined } });
          void refetchEvaluator();
        },
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
    refetchEvaluator,
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
          onClick={handleSave}
          loading={updateMutation.isPending}
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
    ),
    [hasLocalChanges, handleDiscard, handleApply, handleSave, updateMutation.isPending],
  );
  useRegisterDrawerFooter(footerContent);

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
  // Cascade-resolved defaults so the inline evaluator form mirrors
  // the project's configured providers (claude-opus, gemini-pro…)
  // instead of falling back to the DEFAULT_MODEL literal.
  const resolvedDefaultModel = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );
  const resolvedDefaultEmbeddings = api.modelProvider.getResolvedDefault.useQuery(
    {
      projectId: project?.id ?? "",
      featureKey: "analytics.topic_clustering_embeddings",
    },
    { enabled: !!project?.id },
  );

  const settingsFromParameters = Object.fromEntries(
    (node.data.parameters ?? []).map(({ identifier, value }) => [identifier, value]),
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
    if (!evaluator || !availableEvaluators || !(evaluator in availableEvaluators)) return;
    if (node.data.parameters) return;

    const evaluatorDefinition = availableEvaluators[evaluator as EvaluatorTypes];

    const setDefaultSettings = (defaultValues: Record<string, any>, prefix: string) => {
      if (!defaultValues) return;

      Object.entries(defaultValues).forEach(([key, value]) => {
        if (typeof value === "object" && !Array.isArray(value) && value !== null) {
          setDefaultSettings(value, `${prefix}.${key}`);
        } else {
          //@ts-expect-error: runtime-built path not a literal form field
          form.setValue(`${prefix}.${key}`, value);
        }
      });
    };

    setDefaultSettings(
      getEvaluatorDefaultSettings(
        evaluatorDefinition,
        {
          defaultModel: resolvedDefaultModel.data?.model ?? null,
          embeddingsModel: resolvedDefaultEmbeddings.data?.model ?? null,
        },
        {
          defaultModel: DEFAULT_MODEL,
          embeddingsModel: DEFAULT_EMBEDDINGS_MODEL,
        },
      ),
      "settings",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluator, resolvedDefaultModel.data?.model, resolvedDefaultEmbeddings.data?.model]);

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
    evaluator && schema instanceof z.ZodObject && Object.keys(schema.shape).length > 0;

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
 * Reusable footer with Discard / Apply / Save buttons for evaluator drawers,
 * rendered outside the properties panel so it can sit in a drawer footer slot.
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
      <Button variant="outline" size="sm" onClick={onApply} data-testid="evaluator-apply-button">
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
