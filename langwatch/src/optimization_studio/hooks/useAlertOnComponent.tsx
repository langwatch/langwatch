import { Button, Text, VStack } from "@chakra-ui/react";
import { useCallback } from "react";
import { toaster } from "../../components/ui/toaster";
import type { BaseComponent } from "../types/dsl";
import { useWorkflowStore } from "./useWorkflowStore";

export const useAlertOnComponent = () => {
  const {
    selectedNode,
    propertiesExpanded,
    setSelectedNode,
    setPropertiesExpanded,
  } = useWorkflowStore((state) => ({
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

      toaster.create({
        title: "Error",
        id: toastId,
        description: (
          <VStack align="start">
            <Text>{execution_state?.error}</Text>
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
          closable: true,
        },
      });
    },
    [
      selectedNode?.id,
      propertiesExpanded,
      setSelectedNode,
      setPropertiesExpanded,
    ]
  );
};
