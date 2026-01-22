import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import { ExecutionOutputPanel } from "~/components/executable-panel/ExecutionOutputPanel";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component } from "../../types/dsl";

export const OutputPanel = ({ node }: { node: Node<Component> }) => {
  const { enableTracing } = useWorkflowStore(
    useShallow((state) => ({
      enableTracing: state.enable_tracing,
    })),
  );

  return (
    <Box
      background="white"
      height="full"
      padding={6}
      border="1px solid"
      borderColor="border.emphasized"
      borderRadius="0 8px 8px 0"
      borderLeftWidth={0}
      boxShadow="0 0 10px rgba(0,0,0,0.05)"
      overflowY="auto"
    >
      <ExecutionOutputPanel
        executionState={node.data.execution_state}
        isTracingEnabled={enableTracing}
        nodeType={node.type}
      />
    </Box>
  );
};
