import { Card } from "@langwatch/design-system/card";
import type { Component } from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";

import { useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import { ExecutionOutputPanel } from "../../executable-panel/execution-output-panel.tsx";

export const OutputPanel = ({ node }: { node: Node<Component> }) => {
  const { enableTracing } = useWorkflowStore(
    useShallow((state) => ({
      enableTracing: state.enable_tracing,
    })),
  );

  return (
    <Card variant="joined-panel" edge="end">
      <ExecutionOutputPanel
        executionState={node.data.execution_state}
        isTracingEnabled={enableTracing}
        nodeType={node.type}
      />
    </Card>
  );
};
