import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { ExecutionStepAccordion } from "../../../components/ExecutionStepAccordion";
import { VStack } from "@chakra-ui/react";
import type { Field } from "~/optimization_studio/types/dsl";
import { useCallback } from "react";

export const CODE_EXECUTION_STEP_ACCORDION_VALUE = "offline_code_execution";

/**
 * This component is used to configure the code execution properties for the offline execution step.
 *
 * It allows users to set up the code execution environment and parameters.
 */
export function CodeExecutionStepAccordion() {
  const { getNodesByType, setNodeInputs, setNodeOutputs } =
    useEvaluationWizardStore(
      useShallow(({ getNodesByType, setNodeInputs, setNodeOutputs }) => ({
        getNodesByType,
        setNodeInputs,
        setNodeOutputs,
      }))
    );

  const executorNode = getNodesByType("code")[0];

  const handleOnInputsChange = useCallback(
    (data: { fields: Field[] }) => {
      if (!executorNode) return;
      setNodeInputs(executorNode.id, data.fields);
    },
    [executorNode, setNodeInputs]
  );

  const handleOnOutputsChange = useCallback(
    (data: { fields: Field[] }) => {
      if (!executorNode) return;
      setNodeOutputs(executorNode.id, data.fields);
    },
    [executorNode, setNodeOutputs]
  );

  if (!executorNode) {
    return null;
  }

  return (
    <ExecutionStepAccordion
      value={CODE_EXECUTION_STEP_ACCORDION_VALUE}
      title="Code Execution"
      showTrigger={true}
    >
      <ExecutionStepAccordion.ParametersField node={executorNode} />
      <ExecutionStepAccordion.InputField
        node={executorNode}
        onChange={handleOnInputsChange}
      />
      <ExecutionStepAccordion.OutputField
        node={executorNode}
        onChange={handleOnOutputsChange}
      />
    </ExecutionStepAccordion>
  );
}
