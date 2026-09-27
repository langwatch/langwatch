import type { LocalPromptConfig } from "@langwatch/experiment-contract";
import type { FieldMapping } from "@langwatch/prompt-browser-kit";
import { nodeDataToLocalPromptConfig } from "@langwatch/prompt-browser/llm-prompt-config-utils";
import { PromptEditorDrawer } from "@langwatch/prompt-browser/surfaces/prompt-editor-drawer";
import {
  type Component,
  type Field,
  fieldSchema,
  type Signature,
} from "@langwatch/workflow-contract";
import type { Edge, Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useSmartSetNode } from "../../../../behavior/use-smart-set-node.ts";
import { useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../../../model/edge-mapping.ts";

/** Check whether two sets of fields have identical identifiers and types (order-independent). */
function fieldsMatch(a: Field[], b: { identifier: string; type: string }[]): boolean {
  if (a.length !== b.length) return false;
  const fieldMap = new Map(a.map((f) => [f.identifier, f.type]));
  return b.every((f) => fieldMap.get(f.identifier) === f.type);
}

/**
 * Merge new fields from the prompt config with the node's existing fields,
 * preserving `field.value` for inputs that already exist and keeping any
 * old fields that still have connected edges (prevents edge disconnection).
 */
function mergeFields({
  oldFields,
  newFields,
  connectedEdges,
  handlePrefix,
}: {
  oldFields: Field[];
  newFields: { identifier: string; type: string; json_schema?: unknown }[];
  connectedEdges: Edge[];
  handlePrefix: string;
}): Field[] {
  const newIds = new Set(newFields.map((f) => f.identifier));

  const mapped = newFields.map((f): Field => {
    const existing = oldFields.find((e) => e.identifier === f.identifier);
    const candidate: Record<string, unknown> = {
      identifier: f.identifier,
      type: f.type as Field["type"],
    };
    if (existing?.value != null) candidate.value = existing.value;
    if (f.json_schema != null) candidate.json_schema = f.json_schema;
    return fieldSchema.parse(candidate);
  });

  // Keep old fields that have connected edges but were removed from the config
  const preserved = oldFields.filter(
    (f) =>
      !newIds.has(f.identifier) &&
      connectedEdges.some(
        (e) =>
          e.targetHandle === `${handlePrefix}.${f.identifier}` ||
          e.sourceHandle === `${handlePrefix}.${f.identifier}`,
      ),
  );

  return [...mapped, ...preserved];
}

/**
 * When input identifiers change positionally (e.g. renamed "question" to
 * "input"), remap edges to the new identifier — only when the old one had
 * an edge and the new one is genuinely new, not reordered.
 */
function remapEdges({
  nodeId,
  oldFields,
  newFields,
  edges,
  connectedEdges,
}: {
  nodeId: string;
  oldFields: Field[];
  newFields: { identifier: string }[];
  edges: Edge[];
  connectedEdges: Edge[];
}): Edge[] | null {
  let updated = edges;
  let changed = false;

  for (let i = 0; i < Math.min(oldFields.length, newFields.length); i++) {
    const oldId = oldFields[i]?.identifier;
    const newId = newFields[i]?.identifier;
    if (!oldId || !newId || oldId === newId) continue;

    const oldHasEdge = connectedEdges.some((e) => e.targetHandle === `inputs.${oldId}`);
    const newExistsInOld = oldFields.some((f) => f.identifier === newId);

    if (oldHasEdge && !newExistsInOld) {
      changed = true;
      updated = updated.map((edge) =>
        edge.target === nodeId && edge.targetHandle === `inputs.${oldId}`
          ? { ...edge, targetHandle: `inputs.${newId}` }
          : edge,
      );
    }
  }

  return changed ? updated : null;
}

type PromptIOField = { identifier: string; type: string };
type PromptIO = { inputs?: PromptIOField[]; outputs?: PromptIOField[] };

/** Maps prompt I/O arrays to DSL Field format, preserving field.value from existing inputs. */
function mapIOToFields(items: PromptIOField[], currentInputs: Field[]): Field[] {
  return items.map((item) => {
    const existing = currentInputs.find((e) => e.identifier === item.identifier);
    return {
      identifier: item.identifier,
      type: item.type as Field["type"],
      ...(existing?.value != null ? { value: existing.value } : {}),
    };
  });
}

function promptIONodeData(prompt: PromptIO, currentInputs: Field[]): Partial<Signature> {
  return {
    ...(prompt.inputs ? { inputs: mapIOToFields(prompt.inputs, currentInputs) } : {}),
    ...(prompt.outputs ? { outputs: mapIOToFields(prompt.outputs, currentInputs) } : {}),
  };
}

/** The canvas reads the model from the "llm" parameter, so the LLM config is mirrored there. */
function mirroredLlmParameters(
  oldParameters: NonNullable<Signature["parameters"]>,
  llm: LocalPromptConfig["llm"],
): Signature["parameters"] {
  if (!oldParameters.some((p) => p.identifier === "llm")) return undefined;
  return oldParameters.map((p) => (p.identifier === "llm" ? { ...p, value: llm } : p));
}

function syncedInputs({
  nodeId,
  oldInputs,
  newInputs,
  edges,
}: {
  nodeId: string;
  oldInputs: Field[];
  newInputs: PromptIOField[];
  edges: Edge[];
}): { inputs: Field[]; remapped: Edge[] | null } {
  const incomingEdges = edges.filter(
    (e) => e.target === nodeId && e.targetHandle?.startsWith("inputs."),
  );
  return {
    inputs: mergeFields({
      oldFields: oldInputs,
      newFields: newInputs,
      connectedEdges: incomingEdges,
      handlePrefix: "inputs",
    }),
    remapped: remapEdges({
      nodeId,
      oldFields: oldInputs,
      newFields: newInputs,
      edges,
      connectedEdges: incomingEdges,
    }),
  };
}

/**
 * Bridges the headless PromptEditorDrawer to the studio's workflow store,
 * as a panel inside StudioDrawerWrapper. Builds sources/mappings from
 * graph edges and syncs save/version/mapping changes back onto the node.
 */
export function SignaturePromptEditorBridge({ node }: { node: Node<Component> }) {
  const signatureNode = node as Node<Signature>;
  const setNode = useSmartSetNode();
  const updateNodeInternals = useUpdateNodeInternals();

  const { nodes, edges, setEdges, getWorkflow, deselectAllNodes } = useWorkflowStore(
    useShallow((state) => ({
      nodes: state.getWorkflow().nodes,
      edges: state.getWorkflow().edges,
      setEdges: state.setEdges,
      getWorkflow: state.getWorkflow,
      deselectAllNodes: state.deselectAllNodes,
    })),
  );

  const availableSources = useMemo(
    () => buildAvailableSources({ nodeId: node.id, nodes, edges }),
    [edges, nodes, node.id],
  );

  const inputMappings = useMemo(
    () =>
      buildInputMappings({
        nodeId: node.id,
        edges,
        inputs: signatureNode.data.inputs ?? [],
      }),
    [edges, node.id, signatureNode.data.inputs],
  );

  const handleInputMappingsChange = useCallback(
    (identifier: string, mapping: FieldMapping | undefined) => {
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

  // Genuine unpublished local edits only. When the node references a saved
  // library prompt (promptId) with no local edits this stays undefined, so the
  // drawer loads and shows the saved prompt instead of a stale mirror of the
  // node's inline parameters (which made a just-saved prompt look deleted).
  const initialLocalConfig = signatureNode.data.localPromptConfig;

  // Inline mirror of the node's parameters, used by the drawer ONLY when the
  // referenced prompt is not found in the project (e.g. a workflow imported
  // from another project) so it can still show the node's actual configuration
  // instead of an empty "New Prompt" form. It is never merged over a prompt
  // that loads successfully from the library.
  const inlineConfigFallback = useMemo(
    () => nodeDataToLocalPromptConfig(signatureNode.data),
    [signatureNode.data],
  );

  const handleLocalConfigChange = useCallback(
    (config: LocalPromptConfig | undefined) => {
      if (!config) {
        setNode({ id: node.id, data: { localPromptConfig: undefined } });
        return;
      }

      const data: Partial<Signature> & Record<string, unknown> = {
        localPromptConfig: config,
      };

      const parameters = mirroredLlmParameters(signatureNode.data.parameters ?? [], config.llm);
      if (parameters) data.parameters = parameters;

      const oldInputs = signatureNode.data.inputs ?? [];
      const oldOutputs = signatureNode.data.outputs ?? [];

      // Only update inputs when the set of identifiers actually changed.
      // Skipping avoids triggering removeInvalidEdges on drawer open.
      if (config.inputs && !fieldsMatch(oldInputs, config.inputs)) {
        const synced = syncedInputs({
          nodeId: node.id,
          oldInputs,
          newInputs: config.inputs,
          edges: getWorkflow().edges,
        });
        data.inputs = synced.inputs;
        if (synced.remapped) setEdges(synced.remapped);
      }

      if (config.outputs && !fieldsMatch(oldOutputs, config.outputs)) {
        data.outputs = mergeFields({
          oldFields: oldOutputs,
          newFields: config.outputs,
          connectedEdges: getWorkflow().edges.filter(
            (e) => e.source === node.id && e.sourceHandle?.startsWith("outputs."),
          ),
          handlePrefix: "outputs",
        });
      }

      setNode({ id: node.id, data });
      updateNodeInternals(node.id);
    },
    [
      node.id,
      signatureNode.data.inputs,
      signatureNode.data.outputs,
      signatureNode.data.parameters,
      setNode,
      updateNodeInternals,
      getWorkflow,
      setEdges,
    ],
  );

  const promptIOData = useCallback(
    (prompt: PromptIO) => promptIONodeData(prompt, signatureNode.data.inputs ?? []),
    [signatureNode.data.inputs],
  );

  const handleSave = useCallback(
    (prompt: {
      id: string;
      name: string;
      version?: number;
      versionId?: string;
      inputs?: { identifier: string; type: string }[];
      outputs?: { identifier: string; type: string }[];
    }) => {
      const data: Partial<Signature> & Record<string, unknown> = {
        promptId: prompt.id,
        promptVersionId: prompt.versionId,
        localPromptConfig: undefined,
        name: prompt.name,
        ...promptIOData(prompt),
      };
      setNode({ id: node.id, data });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals, promptIOData],
  );

  const handleVersionChange = useCallback(
    (prompt: {
      version: number;
      versionId: string;
      inputs?: { identifier: string; type: string }[];
      outputs?: { identifier: string; type: string }[];
    }) => {
      const data: Partial<Signature> & Record<string, unknown> = {
        promptVersionId: prompt.versionId,
        ...promptIOData(prompt),
      };
      setNode({ id: node.id, data });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals, promptIOData],
  );

  return (
    <PromptEditorDrawer
      headless={true}
      onClose={deselectAllNodes}
      promptId={signatureNode.data.promptId}
      promptVersionId={signatureNode.data.promptVersionId}
      initialLocalConfig={initialLocalConfig}
      inlineConfigFallback={inlineConfigFallback}
      onLocalConfigChange={handleLocalConfigChange}
      onSave={handleSave}
      onVersionChange={handleVersionChange}
      availableSources={availableSources}
      inputMappings={inputMappings}
      onInputMappingsChange={handleInputMappingsChange}
    />
  );
}
