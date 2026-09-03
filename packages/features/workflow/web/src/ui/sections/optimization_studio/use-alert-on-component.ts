import { useCallback } from "react";
import { toaster } from "../../../behavior/studio-host/toaster";
import type { BaseComponent } from "@langwatch/workflow-contract";
import { reportableExecutionFailure } from "./execution-state-error";
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
      // the properties panel and the logs. What travels is the node's CODE, as
      // the serialised handled error the engine sent, and the application
      // resolves the words and the copyable error id from it. See ADR-045.
      //
      // "Go to component" used to be a `<Button>` rendered inside the toast's
      // `description`, which the feedback capability takes as text: the button
      // was dropped on the floor at the port. It is an offered ACTION now, and
      // the application's toaster draws and dismisses it.
      toaster.create({
        error: reportableExecutionFailure(execution_state),
        title: "That step didn't run",
        id: toastId,
        type: "error",
        duration: 5000,
        action: {
          label: "Go to component",
          onClick: () => {
            setSelectedNode(componentId);
            setPropertiesExpanded(true);
          },
        },
      });
    },
    [selectedNode?.id, propertiesExpanded, setSelectedNode, setPropertiesExpanded],
  );
};
