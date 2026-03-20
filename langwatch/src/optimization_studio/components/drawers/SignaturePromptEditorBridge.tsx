import { useCallback, useMemo } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";

import { PromptEditorDrawer } from "~/components/prompts/PromptEditorDrawer";
import type { FieldMapping } from "~/components/variables";
import type { LocalPromptConfig } from "~/evaluations-v3/types";
import { nodeDataToLocalPromptConfig } from "~/prompts/utils/llmPromptConfigUtils";
import { useSmartSetNode } from "../../hooks/useSmartSetNode";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, Field, Signature } from "../../types/dsl";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../utils/edgeMappingUtils";

/** Check whether two sets of fields have identical identifiers (order-independent). */
function identifiersMatch(a: Field[], b: { identifier: string }[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((f) => f.identifier));
  return b.every((f) => ids.has(f.identifier));
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
  newFields: { identifier: string; type: string }[];
  connectedEdges: Edge[];
  handlePrefix: string;
}): Field[] {
  const newIds = new Set(newFields.map((f) => f.identifier));

  const mapped = newFields.map((f) => {
    const existing = oldFields.find((e) => e.identifier === f.identifier);
    return {
      identifier: f.identifier,
      type: f.type as Field["type"],
      ...(existing?.value != null ? { value: existing.value } : {}),
    };
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
 * When input identifiers change positionally (e.g. prompt renamed "question"
 * to "input"), remap edges to point at the new identifier. Only remaps when
 * the old identifier has an edge and the new identifier is genuinely new
 * (not a reordered existing identifier).
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

    const oldHasEdge = connectedEdges.some(
      (e) => e.targetHandle === `inputs.${oldId}`,
    );
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

/**
 * Bridge component that connects the PromptEditorDrawer (headless) to the
 * optimization studio's workflow store.
 *
 * Renders as a panel component inside StudioDrawerWrapper — accepts the
 * standard `{ node }` props interface used by all panel components.
 *
 * Responsibilities:
 * - Passes promptId, promptVersionId, and localPromptConfig from node data
 * - Builds availableSources and inputMappings from the workflow graph edges
 * - Handles onLocalConfigChange by updating node.data.localPromptConfig + syncing inputs/outputs
 * - Handles onSave by storing promptId/promptVersionId and clearing localPromptConfig
 * - Handles onVersionChange by updating promptVersionId and I/O on the node
 * - Handles onInputMappingsChange by creating/removing edges in the workflow
 */
export function SignaturePromptEditorBridge({
  node,
}: {
  node: Node<Component>;
}) {
  const signatureNode = node as Node<Signature>;
  const setNode = useSmartSetNode();
  const updateNodeInternals = useUpdateNodeInternals();

  const { nodes, edges, setEdges, getWorkflow, deselectAllNodes } =
    useWorkflowStore(
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
      const currentInputs =
        workflow.nodes.find((n) => n.id === node.id)?.data.inputs ?? [];
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

  /**
   * Backward compatibility: when a node has no promptId and no localPromptConfig
   * but has inline parameters (old workflow format), convert the inline config
   * to LocalPromptConfig so the PromptEditorDrawer can display it for editing.
   */
  const initialLocalConfig = useMemo(() => {
    // If the node already has a local config, use it directly
    if (signatureNode.data.localPromptConfig) {
      return signatureNode.data.localPromptConfig;
    }
    // Fall back to extracting config from inline parameters.
    // When promptId is set and the prompt exists in DB, the drawer will use
    // the DB data and ignore this. When the prompt is NOT found (e.g. after
    // importing a workflow from another project), this provides the fallback
    // so the drawer can display the node's actual inline configuration
    // instead of an empty "New Prompt" form.
    return nodeDataToLocalPromptConfig(signatureNode.data);
  }, [
    signatureNode.data.localPromptConfig,
    signatureNode.data,
  ]);

  const handleLocalConfigChange = useCallback(
    (config: LocalPromptConfig | undefined) => {
      if (!config) {
        setNode({ id: node.id, data: { localPromptConfig: undefined } });
        return;
      }

      const data: Partial<Signature> & Record<string, unknown> = {
        localPromptConfig: config,
      };

      const oldInputs = signatureNode.data.inputs ?? [];
      const oldOutputs = signatureNode.data.outputs ?? [];

      // Only update inputs when the set of identifiers actually changed.
      // Skipping avoids triggering removeInvalidEdges on drawer open.
      if (config.inputs && !identifiersMatch(oldInputs, config.inputs)) {
        const currentEdges = getWorkflow().edges;
        const incomingEdges = currentEdges.filter(
          (e) => e.target === node.id && e.targetHandle?.startsWith("inputs."),
        );

        data.inputs = mergeFields({
          oldFields: oldInputs,
          newFields: config.inputs,
          connectedEdges: incomingEdges,
          handlePrefix: "inputs",
        });

        const remapped = remapEdges({
          nodeId: node.id,
          oldFields: oldInputs,
          newFields: config.inputs,
          edges: currentEdges,
          connectedEdges: incomingEdges,
        });
        if (remapped) setEdges(remapped);
      }

      if (config.outputs && !identifiersMatch(oldOutputs, config.outputs)) {
        const currentEdges = getWorkflow().edges;
        const outgoingEdges = currentEdges.filter(
          (e) => e.source === node.id && e.sourceHandle?.startsWith("outputs."),
        );

        data.outputs = mergeFields({
          oldFields: oldOutputs,
          newFields: config.outputs,
          connectedEdges: outgoingEdges,
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
      setNode,
      updateNodeInternals,
      getWorkflow,
      setEdges,
    ],
  );

  /** Maps prompt I/O arrays to DSL Field format, preserving field.value from existing inputs. */
  const mapIOToFields = useCallback(
    (
      items?: Array<{ identifier: string; type: string }>,
    ): Field[] | undefined => {
      if (!items) return undefined;
      const currentInputs = signatureNode.data.inputs ?? [];
      return items.map((item) => {
        const existing = currentInputs.find(
          (e) => e.identifier === item.identifier,
        );
        return {
          identifier: item.identifier,
          type: item.type as Field["type"],
          ...(existing?.value != null ? { value: existing.value } : {}),
        };
      });
    },
    [signatureNode.data.inputs],
  );

  const handleSave = useCallback(
    (prompt: {
      id: string;
      name: string;
      version?: number;
      versionId?: string;
      inputs?: Array<{ identifier: string; type: string }>;
      outputs?: Array<{ identifier: string; type: string }>;
    }) => {
      const data: Partial<Signature> & Record<string, unknown> = {
        promptId: prompt.id,
        promptVersionId: prompt.versionId,
        localPromptConfig: undefined,
        name: prompt.name,
      };

      const inputs = mapIOToFields(prompt.inputs);
      if (inputs) data.inputs = inputs;

      const outputs = mapIOToFields(prompt.outputs);
      if (outputs) data.outputs = outputs;

      setNode({ id: node.id, data });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals, mapIOToFields],
  );

  const handleVersionChange = useCallback(
    (prompt: {
      version: number;
      versionId: string;
      inputs?: Array<{ identifier: string; type: string }>;
      outputs?: Array<{ identifier: string; type: string }>;
    }) => {
      const data: Partial<Signature> & Record<string, unknown> = {
        promptVersionId: prompt.versionId,
      };

      const inputs = mapIOToFields(prompt.inputs);
      if (inputs) data.inputs = inputs;

      const outputs = mapIOToFields(prompt.outputs);
      if (outputs) data.outputs = outputs;

      setNode({ id: node.id, data });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals, mapIOToFields],
  );

  return (
    <PromptEditorDrawer
      headless={true}
      onClose={deselectAllNodes}
      promptId={signatureNode.data.promptId}
      promptVersionId={signatureNode.data.promptVersionId}
      initialLocalConfig={initialLocalConfig}
      onLocalConfigChange={handleLocalConfigChange}
      onSave={handleSave}
      onVersionChange={handleVersionChange}
      availableSources={availableSources}
      inputMappings={inputMappings}
      onInputMappingsChange={handleInputMappingsChange}
    />
  );
}
