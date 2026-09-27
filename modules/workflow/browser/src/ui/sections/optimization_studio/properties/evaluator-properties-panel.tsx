import { Button, HStack, Spacer, Spinner } from "@chakra-ui/react";
import type { UiEvaluatorEditorValues } from "@langwatch/browser-host/declarations";
import { api, type RouterOutputs } from "@langwatch/browser-trpc/workflow-api";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
  evaluatorSettingsSchemaFor,
} from "@langwatch/evaluator-contract";
import { useRegisterDrawerFooter } from "@langwatch/workflow-browser-kit";
import type { Evaluator, Field } from "@langwatch/workflow-contract";
import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { z } from "zod";
import { useShallow } from "zustand/react/shallow";

import {
  EvaluatorSettingsForm,
  StudioEvaluatorEditor,
} from "../../../../behavior/lent-evaluator.tsx";
import { useOrganizationTeamProject } from "../../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
  type StudioFieldMapping,
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

  const effectiveEvaluatorDef = useMemo(() => {
    const fields = evaluator?.fields;
    if (fields && fields.length > 0) {
      const requiredFields = fields.filter((f) => !f.optional).map((f) => f.identifier);
      const optionalFields = fields.filter((f) => f.optional).map((f) => f.identifier);
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
  const valuesRef = useRef<UiEvaluatorEditorValues>({
    name: localConfig?.name ?? dbName,
    settings: localConfig?.settings ?? dbSettings,
  });
  const [editorGeneration, setEditorGeneration] = useState(0);

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

  const handleEditorChange = useCallback(
    (values: UiEvaluatorEditorValues) => {
      valuesRef.current = values;
      debouncedSetLocalConfig(values);
    },
    [debouncedSetLocalConfig],
  );

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
    (identifier: string, mapping: StudioFieldMapping | undefined) => {
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

  const mappingsConfig = useMemo(
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
    const formValues = valuesRef.current;
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
  }, [project?.id, evaluatorId, evaluatorType, updateMutation, setNode, node.id, refetchEvaluator]);

  const handleDiscard = useCallback(() => {
    debouncedSetLocalConfig.cancel();
    valuesRef.current = { name: dbName, settings: dbSettings };
    setEditorGeneration((generation) => generation + 1);
    setNode({ id: node.id, data: { localConfig: undefined } });
  }, [dbName, dbSettings, setNode, node.id, debouncedSetLocalConfig]);

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
    <StudioEvaluatorEditor
      key={editorGeneration}
      evaluatorType={evaluatorType}
      description={evaluatorDef?.description}
      isWorkflowEvaluator={isWorkflowEvaluator}
      workflow={workflow}
      fields={effectiveEvaluatorDef}
      initialValues={valuesRef.current}
      onChange={handleEditorChange}
      mappings={mappingsConfig}
    />
  );
}

// ---------------------------------------------------------------------------
// Old format: inline evaluator panel (backward compatibility)
// ---------------------------------------------------------------------------

function InlineEvaluatorPanel({ node }: { node: Node<Evaluator> }) {
  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));
  const evaluator = node.data.evaluator;
  const initialSettings = useMemo(
    () =>
      Object.fromEntries(
        (node.data.parameters ?? []).map(({ identifier, value }) => [identifier, value]),
      ),
    // Seeds the form once; later writes flow from the form to the node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const writeParameters = useCallback(
    (settings: Record<string, unknown>) => {
      setNode({
        id: node.id,
        data: {
          parameters: Object.entries(settings).map(
            ([identifier, value]) => ({ identifier, type: "str", value }) as Field,
          ),
        },
      });
    },
    [node.id, setNode],
  );
  const writeParametersDebounced = useDebouncedCallback(writeParameters, 100, {
    leading: true,
    trailing: false,
  });

  const hasEvaluatorFields = !!evaluator && hasSettingsFields(evaluator);

  return (
    <BasePropertiesPanel node={node} hideParameters={hasEvaluatorFields}>
      {hasEvaluatorFields && (
        <EvaluatorSettingsForm
          evaluatorType={evaluator}
          initialSettings={initialSettings}
          applyDefaults={!node.data.parameters}
          onChange={writeParametersDebounced}
        />
      )}
    </BasePropertiesPanel>
  );
}

function hasSettingsFields(evaluatorType: string): boolean {
  const lookup = evaluatorSettingsSchemaFor(evaluatorType);
  return (
    lookup.found &&
    lookup.schema instanceof z.ZodObject &&
    Object.keys(lookup.schema.shape).length > 0
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
