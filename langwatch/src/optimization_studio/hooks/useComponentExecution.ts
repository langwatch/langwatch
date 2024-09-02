import { useCallback, useEffect, useState } from "react";
import { useSocketClient } from "./useSocketClient";
import { useWorkflowStore } from "./useWorkflowStore";
import type { StudioClientEvent } from "../types/events";
import type { Node } from "@xyflow/react";
import type { BaseComponent, Component } from "../types/dsl";
import { nanoid } from "nanoid";
import { useToast } from "@chakra-ui/react";
import { useAlertOnComponent } from "./useAlertOnComponent";

export const useComponentExecution = () => {
  const { setComponentExecutionState } = useWorkflowStore();
  const { sendMessage, socketStatus } = useSocketClient();

  const toast = useToast();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    component_id: string;
    trace_id: string;
  } | null>(null);

  const { node } = useWorkflowStore((state) => ({
    node: state.nodes.find((node) => node.id === triggerTimeout?.component_id),
  }));

  const alertOnComponent = useAlertOnComponent();

  useEffect(() => {
    if (
      triggerTimeout &&
      node &&
      node.data.execution_state?.trace_id === triggerTimeout.trace_id &&
      node.data.execution_state?.state === "waiting"
    ) {
      const execution_state: BaseComponent["execution_state"] = {
        state: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      };
      setComponentExecutionState(node.id, execution_state);
      alertOnComponent({ componentId: node.id, execution_state });
    }
  }, [triggerTimeout, node, setComponentExecutionState, alertOnComponent]);

  const startComponentExecution = useCallback(
    ({
      node,
      inputs,
    }: {
      node: Node<Component>;
      inputs: Record<string, string>;
    }) => {
      if (socketStatus !== "connected") {
        toast({
          title: "Studio is not connected",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      const trace_id = `trace_${nanoid()}`;

      setComponentExecutionState(node.id, {
        state: "waiting",
        trace_id,
      });

      const payload: StudioClientEvent = {
        type: "execute_component",
        payload: { trace_id, node, inputs },
      };
      sendMessage(payload);

      setTimeout(() => {
        setTriggerTimeout({ component_id: node.id, trace_id });
      }, 10_000);
    },
    [socketStatus, setComponentExecutionState, sendMessage, toast]
  );

  return {
    startComponentExecution,
  };
};
