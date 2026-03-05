import { useCallback, useRef } from "react";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import type { TypedAgent } from "~/server/agents/agent.repository";
import type { Component, Field } from "../types/dsl";
import type { NodeWithOptionalPosition } from "~/types";
import { useWorkflowStore } from "./useWorkflowStore";

/**
 * Map agent inputs to Field array for the studio node.
 */
function mapAgentInputs(agent: TypedAgent): Field[] {
  const config = agent.config;
  if ("inputs" in config && Array.isArray(config.inputs) && config.inputs.length > 0) {
    return config.inputs.map((i: { identifier: string; type: string }) => ({
      identifier: i.identifier,
      type: i.type as Field["type"],
    }));
  }
  // Default input for agents
  return [{ identifier: "input", type: "str" }];
}

/**
 * Map agent outputs to Field array for the studio node.
 */
function mapAgentOutputs(agent: TypedAgent): Field[] {
  const config = agent.config;
  if ("outputs" in config && Array.isArray(config.outputs) && config.outputs.length > 0) {
    return config.outputs.map((o: { identifier: string; type: string }) => ({
      identifier: o.identifier,
      type: o.type as Field["type"],
    }));
  }
  // Default output
  return [{ identifier: "output", type: "str" }];
}

/**
 * Build parameters array from agent config for backend execution.
 * The backend parser reads parameters to determine how to execute.
 */
function buildAgentParameters(agent: TypedAgent): Field[] {
  const params: Field[] = [
    { identifier: "agent_type", type: "str", value: agent.type },
  ];

  const config = agent.config as Record<string, unknown>;

  switch (agent.type) {
    case "http": {
      if (config.url) params.push({ identifier: "url", type: "str", value: config.url as string });
      if (config.method) params.push({ identifier: "method", type: "str", value: config.method as string });
      if (config.bodyTemplate) params.push({ identifier: "body_template", type: "str", value: config.bodyTemplate as string });
      if (config.outputPath) params.push({ identifier: "output_path", type: "str", value: config.outputPath as string });
      if (config.timeoutMs) params.push({ identifier: "timeout_ms", type: "str", value: config.timeoutMs });

      // Auth
      const auth = config.auth as Record<string, string> | undefined;
      if (auth?.type && auth.type !== "none") {
        params.push({ identifier: "auth_type", type: "str", value: auth.type });
        if (auth.token) params.push({ identifier: "auth_token", type: "str", value: auth.token });
        if (auth.header) params.push({ identifier: "auth_header", type: "str", value: auth.header });
        if (auth.value) params.push({ identifier: "auth_value", type: "str", value: auth.value });
        if (auth.username) params.push({ identifier: "auth_username", type: "str", value: auth.username });
        if (auth.password) params.push({ identifier: "auth_password", type: "str", value: auth.password });
      }

      // Headers
      if (config.headers && typeof config.headers === "object") {
        const headers = Array.isArray(config.headers)
          ? Object.fromEntries(
              (config.headers as Array<{ key: string; value: string }>)
                .filter((h) => h.key)
                .map((h) => [h.key, h.value]),
            )
          : config.headers;
        params.push({ identifier: "headers", type: "str", value: headers });
      }
      break;
    }
    case "code": {
      // Code agents store their code in the parameters
      const existingParams = config.parameters as Array<{ identifier: string; type: string; value: unknown }> | undefined;
      const codeParam = existingParams?.find((p) => p.identifier === "code");
      if (codeParam) {
        params.push({ identifier: "code", type: "code", value: codeParam.value as string });
      }
      break;
    }
    case "workflow": {
      if (config.workflow_id) params.push({ identifier: "workflow_id", type: "str", value: config.workflow_id as string });
      if (config.version_id) params.push({ identifier: "version_id", type: "str", value: config.version_id as string });
      break;
    }
  }

  return params;
}

/**
 * Hook that provides a drag-end handler for the Agent node draggable.
 *
 * When an agent node is dropped on the canvas, this opens the
 * AgentListDrawer so the user can pick an existing agent or create
 * a new one. The flow mirrors useEvaluatorPickerFlow:
 *
 * - onSelect: updates the placeholder node with agent data, selects it
 * - onCreateNew: opens the agent type selector to create a new one
 * - onClose (cancel): removes the placeholder node from the canvas
 */
export function useAgentPickerFlow() {
  const { openDrawer, closeDrawer } = useDrawer();
  const { setNode, deleteNode, setSelectedNode } = useWorkflowStore(
    (state) => ({
      setNode: state.setNode,
      deleteNode: state.deleteNode,
      setSelectedNode: state.setSelectedNode,
    }),
  );

  const pendingAgentRef = useRef<string | null>(null);

  const handleAgentDragEnd = useCallback(
    (item: { node: NodeWithOptionalPosition<Component> }) => {
      const nodeId = item.node.id;
      pendingAgentRef.current = nodeId;

      setFlowCallbacks("agentList", {
        onSelect: (agent: TypedAgent) => {
          if (pendingAgentRef.current) {
            setNode({
              id: pendingAgentRef.current,
              data: {
                name: agent.name,
                agent: `agents/${agent.id}`,
                agentType: agent.type as "http" | "code" | "workflow",
                inputs: mapAgentInputs(agent),
                outputs: mapAgentOutputs(agent),
                parameters: buildAgentParameters(agent),
              } as Partial<Component>,
            });
            const nodeToSelect = pendingAgentRef.current;
            pendingAgentRef.current = null;
            closeDrawer();
            setSelectedNode(nodeToSelect);
          }
        },
        onCreateNew: () => {
          // Wire up so newly created agent is applied to the pending node
          const onAgentSaved = (agent: TypedAgent) => {
            if (pendingAgentRef.current) {
              setNode({
                id: pendingAgentRef.current,
                data: {
                  name: agent.name,
                  agent: `agents/${agent.id}`,
                  agentType: agent.type as "http" | "code" | "workflow",
                  inputs: mapAgentInputs(agent),
                  outputs: mapAgentOutputs(agent),
                  parameters: buildAgentParameters(agent),
                } as Partial<Component>,
              });
              const nodeId = pendingAgentRef.current;
              pendingAgentRef.current = null;
              closeDrawer();
              setSelectedNode(nodeId);
            }
          };
          setFlowCallbacks("agentHttpEditor", { onSave: onAgentSaved });
          setFlowCallbacks("agentCodeEditor", { onSave: onAgentSaved });
          setFlowCallbacks("workflowSelector", { onSave: onAgentSaved });
          openDrawer("agentTypeSelector");
        },
        onClose: () => {
          // Cancel: remove the placeholder node
          if (pendingAgentRef.current) {
            deleteNode(pendingAgentRef.current);
            pendingAgentRef.current = null;
          }
          closeDrawer();
        },
      });

      // Defer drawer opening to next tick so ReactFlow's D3 drag system
      // finishes processing the drop before we trigger a URL change (re-render).
      setTimeout(() => {
        openDrawer("agentList", undefined, { resetStack: true });
      }, 0);
    },
    [openDrawer, closeDrawer, setNode, deleteNode, setSelectedNode],
  );

  return { handleAgentDragEnd, pendingAgentRef };
}
