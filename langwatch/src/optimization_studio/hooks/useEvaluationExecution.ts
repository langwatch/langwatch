import { useCallback, useEffect, useState } from "react";
import { useSocketClient } from "./useSocketClient";
import { useWorkflowStore } from "./useWorkflowStore";
import type { StudioClientEvent } from "../types/events";
import type { Node } from "@xyflow/react";
import type { BaseComponent, Component, Field } from "../types/dsl";
import { nanoid } from "nanoid";
import { useToast } from "@chakra-ui/react";

export const useEvaluationExecution = () => {
  const { sendMessage, socketStatus } = useSocketClient();

  const toast = useToast();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    run_id: string;
    timeout_on_status: "waiting" | "running";
  } | null>(null);

  const { getWorkflow, setEvaluationState } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
    setEvaluationState: state.setEvaluationState,
  }));

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

  useEffect(() => {
    const workflow = getWorkflow();
    if (
      triggerTimeout &&
      workflow.state.evaluation?.run_id === triggerTimeout.run_id &&
      workflow.state.evaluation?.status === triggerTimeout.timeout_on_status
    ) {
      setEvaluationState({
        status: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      });
      toast({
        title: "Timeout starting evaluation execution",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  }, [triggerTimeout, setEvaluationState, getWorkflow, toast]);

  const startEvaluationExecution = useCallback(() => {
    if (!socketAvailable()) {
      return;
    }

    const run_id = `run_${nanoid()}`;

    setEvaluationState({
      status: "waiting",
      run_id,
    });

    const payload: StudioClientEvent = {
      type: "execute_evaluation",
      payload: {
        run_id,
        workflow: getWorkflow(),
      },
    };
    console.log("payload", JSON.stringify(payload, undefined, 2));
    sendMessage(payload);

    setTimeout(() => {
      setTriggerTimeout({ run_id, timeout_on_status: "waiting" });
    }, 10_000);
  }, [socketAvailable, getWorkflow, sendMessage, setEvaluationState]);

  const stopEvaluationExecution = useCallback(
    ({
      run_id,
      node_id,
    }: {
      run_id: string;
      node_id: string;
      current_state: BaseComponent["execution_state"];
    }) => {
      if (!socketAvailable()) {
        return;
      }

      const workflow = getWorkflow();
      const current_state = workflow.state.execution?.status;
      if (current_state === "waiting") {
        setEvaluationState({
          status: "idle",
          run_id: undefined,
        });
        return;
      }

      const payload: StudioClientEvent = {
        type: "stop_execution",
        payload: { trace_id: run_id, node_id },
      };
      sendMessage(payload);

      setTimeout(() => {
        setTriggerTimeout({
          run_id,
          timeout_on_status: "running",
        });
      }, 2_000);
    },
    [socketAvailable, setEvaluationState, sendMessage, getWorkflow]
  );

  return {
    startEvaluationExecution,
    stopEvaluationExecution,
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
