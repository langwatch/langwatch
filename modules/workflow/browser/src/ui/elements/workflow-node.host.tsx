import type { Node, NodeProps } from "@xyflow/react";
import { createContext, useContext } from "react";

import type { Component, ComponentType, Custom, Entry } from "@langwatch/workflow-contract";

type NodeHost = {
  ComponentIcon: React.ComponentType<{
    type: ComponentType;
    cls?: string;
    size: "xs" | "md" | "lg";
    behave_as?: "evaluator";
  }>;
  LLMModelDisplay: React.ComponentType<{ model: string; fontSize?: string }>;
  HoverableBigText: React.ComponentType<{
    children: React.ReactNode;
    lineClamp: number;
    expandable: boolean;
  }>;
  useColorModeValue: (light: string, dark: string) => string;
  useComponentExecution: () => {
    startComponentExecution: (input: { node: Node<Component> }) => void;
    stopComponentExecution: (input: {
      node_id: string;
      trace_id: string;
      current_state: Component["execution_state"];
    }) => void;
  };
  useComponentVersion: (node: NodeProps<Node<Custom>>) => {
    currentVersion?: { isPublishedVersion?: boolean } | null;
  };
  useEntryDatasetTotal: (dataset: Entry["dataset"]) => number | null | undefined;
};

const WorkflowNodeHostContext = createContext<NodeHost | null>(null);

export const WorkflowNodeHostProvider = WorkflowNodeHostContext.Provider;

export function useWorkflowNodeHost(): NodeHost {
  const host = useContext(WorkflowNodeHostContext);
  if (!host) {
    throw new Error("Workflow node renderers require a WorkflowNodeHostProvider");
  }
  return host;
}
