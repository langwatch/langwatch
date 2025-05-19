import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import {
  ExecutionInputPanel,
  type InputField,
  type ExecuteData,
} from "~/components/executable-panel/ExecutionInputPanel";
import {
  getInputsForExecution,
  useComponentExecution,
} from "../../hooks/useComponentExecution";
import type { Component } from "../../types/dsl";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";

/**
 * InputPanel component that handles the display and execution of component inputs
 *
 * @param node - The workflow node containing component data
 */
export const InputPanel = ({ node }: { node: Node<Component> }) => {
  // Get input values and identify required fields
  const { inputs, missingFields } = getInputsForExecution({ node });
  const [animationFinished, setAnimationFinished] = useState(false);

  // Access workflow store state for validation triggering
  const { triggerValidation, setTriggerValidation } = useWorkflowStore(
    (state) => ({
      triggerValidation: state.triggerValidation,
      setTriggerValidation: state.setTriggerValidation,
    })
  );

  // Hook to execute the component
  const { startComponentExecution } = useComponentExecution();

  // Convert node inputs to the format expected by ExecutionInputPanel
  const inputFields: InputField[] =
    node.data.inputs?.map((input) => ({
      identifier: input.identifier,
      type: input.type,
      optional: !missingFields.some(
        (field) => field.identifier === input.identifier
      ),
      value: inputs[input.identifier],
    })) || [];

  // Handle execution when the user submits the form
  const onExecute = useCallback(
    (data: ExecuteData) => {
      startComponentExecution({ node, inputs: data });
    },
    [node, startComponentExecution]
  );

  // Set animation finished after initial delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationFinished(true);
    }, 700);

    return () => clearTimeout(timer);
  }, []);

  // Handle programmatic execution when triggered from elsewhere
  useEffect(() => {
    if (!triggerValidation) return;

    const timer = setTimeout(
      () => {
        // Only execute if we have inputs to process
        if (inputFields.length > 0) {
          // Convert input values to appropriate string format
          const formData = Object.fromEntries(
            inputFields.map((field) => [
              field.identifier,
              typeof field.value === "object"
                ? JSON.stringify(field.value)
                : field.value?.toString() || "",
            ])
          );
          onExecute(formData);
        }
      },
      animationFinished ? 0 : 700
    );

    setTriggerValidation(false);
    return () => clearTimeout(timer);
  }, [
    animationFinished,
    inputFields,
    onExecute,
    setTriggerValidation,
    triggerValidation,
  ]);

  return (
    <Box
      background="white"
      height="full"
      padding={6}
      border="1px solid"
      borderColor="gray.350"
      borderRadius="8px 0 0 8px"
      borderRightWidth={0}
      boxShadow="0 0 10px rgba(0,0,0,0.05)"
      overflowY="auto"
    >
      <ExecutionInputPanel
        fields={inputFields}
        onExecute={onExecute}
        title="Inputs"
        buttonText="Execute"
      />
    </Box>
  );
};
