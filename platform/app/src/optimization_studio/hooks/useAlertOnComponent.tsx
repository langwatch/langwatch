import { Button, Text, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
import { toaster } from "../../components/ui/toaster";
import type { BaseComponent } from "@langwatch/workflow-contract";
import { explainExecutionStateError } from "../utils/executionStateError";
import { useWorkflowStore } from "@langwatch/workflow-web";

export const useAlertOnComponent = () => {
  const { selectedNode, propertiesExpanded, setSelectedNode, setPropertiesExpanded } =
    useWorkflowStore((state) => ({
      selectedNode: state.nodes.find((node) => node.selected),
      propertiesExpanded: state.propertiesExpanded,
      setSelectedNode: state.setSelectedNode,
      setPropertiesExpanded: state.setPropertiesExpanded,
    }));

  return useCallback(
    ({
      componentId,
      execution_state,
    }: {
      componentId: string;
      execution_state: BaseComponent["execution_state"];
    }) => {
      if (componentId === selectedNode?.id && propertiesExpanded) {
        return;
      }

      const toastId = `component-error-${componentId}`;

      // The node's raw `error` names hosts, URLs and Go internals — it stays in
      // the properties panel and the logs. The customer reads the copy the
      // registry holds for the node's code, or, for a failure with no code,
      // the generic unknown state under this headline. See ADR-045.
      const { title, description, traceId } = explainExecutionStateError({
        state: execution_state,
        fallbackTitle: "That step didn't run",
      });

      toaster.create({
        title,
        id: toastId,
        description: (
          <VStack align="start">
            {description && <Text>{description}</Text>}
            <Button
              unstyled
              color="white"
              cursor="pointer"
              textDecoration="underline"
              size="sm"
              onClick={() => {
                setSelectedNode(componentId);
                setPropertiesExpanded(true);
                toaster.dismiss(toastId);
              }}
            >
              Go to component
            </Button>
          </VStack>
        ),
        type: "error",
        duration: 5000,
        meta: {
          // The copyable error id, which is all a customer gets of the
          // technical detail when the failure carried no code.
          traceId,
        },
      });
    },
    [selectedNode?.id, propertiesExpanded, setSelectedNode, setPropertiesExpanded],
  );
};
