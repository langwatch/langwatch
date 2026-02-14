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
  applyMappingChangeToEdges,
  buildAvailableSources,
  buildInputMappingsFromEdges,
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
    () => buildInputMappingsFromEdges({ nodeId: node.id, edges }),
    [edges, node.id],
  );

  const handleInputMappingsChange = useCallback(
    (identifier: string, mapping: FieldMapping | undefined) => {
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

        data.inputs = newInputs.map((i) => ({
          identifier: i.identifier,
          type: i.type as Field["type"],
        }));

        // When input identifiers change (e.g. prompt loads with "input" but
        // node had "question"), update existing edge targetHandles to match
        // the new identifiers so edges stay connected.
        if (oldInputs.length > 0 && newInputs.length > 0) {
          const currentEdges = getWorkflow().edges;
          let updatedEdges = currentEdges;

          for (
            let idx = 0;
            idx < Math.min(oldInputs.length, newInputs.length);
            idx++
          ) {
            const oldId = oldInputs[idx]?.identifier;
            const newId = newInputs[idx]?.identifier;
            if (oldId && newId && oldId !== newId) {
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

          if (updatedEdges !== currentEdges) {
            setEdges(updatedEdges);
          }
        }
      }

      if (config.outputs) {
        data.outputs = config.outputs.map((o) => ({
          identifier: o.identifier,
          type: o.type as Field["type"],
        }));
      }

      setNode({ id: node.id, data });
      updateNodeInternals(node.id);
    },
    [
      node.id,
      signatureNode.data.inputs,
      setNode,
      updateNodeInternals,
      getWorkflow,
      setEdges,
    ],
  );

  /** Maps prompt I/O arrays to DSL Field format. */
  const mapIOToFields = useCallback(
    (
      items?: Array<{ identifier: string; type: string }>,
    ): Field[] | undefined => {
      if (!items) return undefined;
      return items.map((item) => ({
        identifier: item.identifier,
        type: item.type as Field["type"],
      }));
    },
    [],
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
