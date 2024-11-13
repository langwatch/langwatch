import { useCallback, useEffect, useState } from "react";
import { useSocketClient } from "./useSocketClient";
import { useWorkflowStore } from "./useWorkflowStore";
import type { StudioClientEvent } from "../types/events";
import type { Node } from "@xyflow/react";
import type { BaseComponent, Component, Field } from "../types/dsl";
import { nanoid } from "nanoid";
import { useToast } from "@chakra-ui/react";
import { useAlertOnComponent } from "./useAlertOnComponent";

export const useComponentExecution = () => {
  const { sendMessage, socketStatus } = useSocketClient();

  const toast = useToast();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    component_id: string;
    trace_id: string;
    timeout_on_status: "waiting" | "running";
  } | null>(null);

  const {
    node,
    setSelectedNode,
    setPropertiesExpanded,
    setTriggerValidation,
    getWorkflow,
    setComponentExecutionState,
  } = useWorkflowStore((state) => ({
    node: state.nodes.find((node) => node.id === triggerTimeout?.component_id),
    setSelectedNode: state.setSelectedNode,
    setPropertiesExpanded: state.setPropertiesExpanded,
    setTriggerValidation: state.setTriggerValidation,
    getWorkflow: state.getWorkflow,
    setComponentExecutionState: state.setComponentExecutionState,
  }));

  const alertOnComponent = useAlertOnComponent();

  useEffect(() => {
    if (
      triggerTimeout &&
      node &&
      node.data.execution_state?.trace_id === triggerTimeout.trace_id &&
      node.data.execution_state?.status === triggerTimeout.timeout_on_status
    ) {
      const execution_state: BaseComponent["execution_state"] = {
        status: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      };
      setComponentExecutionState(node.id, execution_state);
      alertOnComponent({ componentId: node.id, execution_state });
    }
  }, [triggerTimeout, node, setComponentExecutionState, alertOnComponent]);

  const socketAvailable = useCallback(() => {
    if (socketStatus !== "connected") {
      toast({
        title: "Studio is not connected",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return false;
    }
    return true;
  }, [socketStatus, toast]);

  const startComponentExecution = useCallback(
    ({
      node,
      inputs,
    }: {
      node: Node<Component>;
      inputs?: Record<string, string>;
    }) => {
      if (!socketAvailable()) {
        return;
      }

      const { missingFields, inputs: inputs_ } = getInputsForExecution({
        node,
        inputs,
      });
      if (missingFields.length > 0) {
        setSelectedNode(node.id);
        setPropertiesExpanded(true);
        setTriggerValidation(true);
        return;
      }

      const workflowId = node.data.workflowId;

      const trace_id = `trace_${nanoid()}`;

      setComponentExecutionState(node.id, {
        status: "waiting",
        trace_id,
        inputs: inputs_,
      });

      // const payload: StudioClientEvent = {
      //   type: "execute_component",
      //   payload: {
      //     trace_id,
      //     workflow: getWorkflow(),
      //     node_id: node.id,
      //     inputs: inputs_,
      //   },
      // };
      // sendMessage(payload);

      setTimeout(() => {
        setTriggerTimeout({
          component_id: node.id,
          trace_id,
          timeout_on_status: "waiting",
        });
      }, 10_000);
    },
    [
      socketAvailable,
      setComponentExecutionState,
      getWorkflow,
      sendMessage,
      setSelectedNode,
      setPropertiesExpanded,
      setTriggerValidation,
    ]
  );

  const stopComponentExecution = useCallback(
    ({
      trace_id,
      node_id,
      current_state,
    }: {
      trace_id: string;
      node_id: string;
      current_state: BaseComponent["execution_state"];
    }) => {
      if (!socketAvailable()) {
        return;
      }

      if (current_state?.status === "waiting") {
        setComponentExecutionState(node_id, {
          status: "idle",
          trace_id: undefined,
        });
        return;
      }

      const payload: StudioClientEvent = {
        type: "stop_execution",
        payload: { trace_id, node_id },
      };
      sendMessage(payload);

      setTimeout(() => {
        setTriggerTimeout({
          component_id: node_id,
          trace_id,
          timeout_on_status: "running",
        });
      }, 2_000);
    },
    [socketAvailable, sendMessage, setComponentExecutionState]
  );

  return {
    startComponentExecution,
    stopComponentExecution,
  };
};

export function getInputsForExecution({
  node,
  inputs,
}: {
  node: Node<Component>;
  inputs?: Record<string, string>;
}): { missingFields: Field[]; inputs: Record<string, string> } {
  const allFields = new Set(
    node.data.inputs?.map((field) => field.identifier) ?? []
  );
  const requiredFields =
    node.data.inputs?.filter((field) => !field.optional) ?? [];
  const defaultValues = node.data.inputs?.reduce(
    (acc, field) => {
      if (field.defaultValue !== undefined) {
        acc[field.identifier] = field.defaultValue;
      }
      return acc;
    },
    {} as Record<string, string>
  );

  const inputs_ = Object.fromEntries(
    Object.entries({
      ...defaultValues,
      ...(node?.data.execution_state?.inputs ?? {}),
      ...(inputs ?? {}),
    }).filter(([key]) => allFields.has(key))
  );

  const missingFields = requiredFields.filter(
    (field) =>
      !(field.identifier in inputs_) ||
      inputs_[field.identifier] === undefined ||
      inputs_[field.identifier] === ""
  );

  return { missingFields, inputs: inputs_ };
}
