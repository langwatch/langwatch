import { useCallback, useMemo } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import type { Node } from "@xyflow/react";
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
    // If the node has a promptId, the drawer fetches the prompt from DB
    if (signatureNode.data.promptId) {
      return undefined;
    }
    // No promptId and no localPromptConfig - check for inline parameters
    return nodeDataToLocalPromptConfig(signatureNode.data);
  }, [
    signatureNode.data.localPromptConfig,
    signatureNode.data.promptId,
    signatureNode.data,
  ]);

  const handleLocalConfigChange = useCallback(
    (config: LocalPromptConfig | undefined) => {
      if (!config) {
        // Clearing local config — just store undefined, don't touch inputs/outputs
        setNode({ id: node.id, data: { localPromptConfig: undefined } });
        return;
      }

      const data: Partial<Signature> & Record<string, unknown> = {
        localPromptConfig: config,
      };

      if (config.inputs) {
        const oldInputs = signatureNode.data.inputs ?? [];
        const newInputs = config.inputs;

        // Check if the identifiers are identical — if so, skip the update
        // to avoid triggering removeInvalidEdges unnecessarily.
        const oldIds = new Set(oldInputs.map((i) => i.identifier));
        const newIds = new Set(newInputs.map((i) => i.identifier));
        const identifiersMatch =
          oldIds.size === newIds.size &&
          [...oldIds].every((id) => newIds.has(id));

        if (!identifiersMatch) {
          // Find edges connected to this node's inputs
          const currentEdges = getWorkflow().edges;
          const connectedEdges = currentEdges.filter(
            (e) => e.target === node.id && e.targetHandle?.startsWith("inputs."),
          );

          // Build the new inputs list, preserving field.value from existing inputs
          data.inputs = newInputs.map((i) => {
            const existing = oldInputs.find(
              (e) => e.identifier === i.identifier,
            );
            return {
              identifier: i.identifier,
              type: i.type as Field["type"],
              ...(existing?.value != null ? { value: existing.value } : {}),
            };
          });

          // Also preserve any old inputs that have connected edges but aren't
          // in the new config — this prevents edge disconnection when the
          // prompt form syncs during drawer initialization.
          for (const oldInput of oldInputs) {
            const hasEdge = connectedEdges.some(
              (e) => e.targetHandle === `inputs.${oldInput.identifier}`,
            );
            const isInNewInputs = newIds.has(oldInput.identifier);
            if (hasEdge && !isInNewInputs) {
              (data.inputs as Field[]).push(oldInput);
            }
          }

          // Remap edges when old inputs have edges but the identifier changed.
          // Match by position only when old input had an edge and new input
          // doesn't already exist in oldInputs (i.e., it's genuinely new).
          if (oldInputs.length > 0 && newInputs.length > 0) {
            let updatedEdges = currentEdges;

            for (
              let idx = 0;
              idx < Math.min(oldInputs.length, newInputs.length);
              idx++
            ) {
              const oldId = oldInputs[idx]?.identifier;
              const newId = newInputs[idx]?.identifier;
              if (oldId && newId && oldId !== newId) {
                // Only remap if the old identifier has an edge and the new
                // identifier doesn't already exist as a separate old input
                // (which would mean it's a reorder, not a rename).
                const oldHasEdge = connectedEdges.some(
                  (e) => e.targetHandle === `inputs.${oldId}`,
                );
                const newExistsInOld = oldInputs.some(
                  (i) => i.identifier === newId,
                );
                if (oldHasEdge && !newExistsInOld) {
                  updatedEdges = updatedEdges.map((edge) => {
                    if (
                      edge.target === node.id &&
                      edge.targetHandle === `inputs.${oldId}`
                    ) {
                      return { ...edge, targetHandle: `inputs.${newId}` };
                    }
                    return edge;
                  });
                }
              }
            }

            if (updatedEdges !== currentEdges) {
              setEdges(updatedEdges);
            }
          }
        }
        // If identifiers match, don't set data.inputs — node already has the right inputs
      }

      if (config.outputs) {
        const oldOutputs = signatureNode.data.outputs ?? [];
        const newOutputs = config.outputs;
        const oldOutIds = new Set(oldOutputs.map((o) => o.identifier));
        const newOutIds = new Set(newOutputs.map((o) => o.identifier));
        const outputsMatch =
          oldOutIds.size === newOutIds.size &&
          [...oldOutIds].every((id) => newOutIds.has(id));

        if (!outputsMatch) {
          // Find edges connected to this node's outputs
          const currentEdges = getWorkflow().edges;
          const connectedOutEdges = currentEdges.filter(
            (e) =>
              e.source === node.id &&
              e.sourceHandle?.startsWith("outputs."),
          );

          data.outputs = newOutputs.map((o) => ({
            identifier: o.identifier,
            type: o.type as Field["type"],
          }));

          // Preserve old outputs that have connected edges but aren't in new config
          for (const oldOutput of oldOutputs) {
            const hasEdge = connectedOutEdges.some(
              (e) => e.sourceHandle === `outputs.${oldOutput.identifier}`,
            );
            const isInNewOutputs = newOutIds.has(oldOutput.identifier);
            if (hasEdge && !isInNewOutputs) {
              (data.outputs as Field[]).push(oldOutput);
            }
          }
        }
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
