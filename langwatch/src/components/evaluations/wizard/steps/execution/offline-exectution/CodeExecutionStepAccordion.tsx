import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import {
  FieldsForm,
  FieldsDefinition,
} from "~/optimization_studio/components/properties/BasePropertiesPanel";
import { ExecutionStepAccordion } from "../../../components/ExecutionStepAccordion";
import { VStack } from "@chakra-ui/react";
import { useUpdateNodeInternals } from "@xyflow/react";
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
  const updateNodeInternals = useUpdateNodeInternals();

  const handleOnInputsChange = useCallback(
    (data: { fields: Field[] }) => {
      if (!executorNode) return;
      setNodeInputs(executorNode.id, data.fields);
      updateNodeInternals(executorNode.id);
    },
    [executorNode, setNodeInputs, updateNodeInternals]
  );

  const handleOnOutputsChange = useCallback(
    (data: { fields: Field[] }) => {
      if (!executorNode) return;
      setNodeOutputs(executorNode.id, data.fields);
      updateNodeInternals(executorNode.id);
    },
    [executorNode, setNodeOutputs, updateNodeInternals]
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
      <VStack width="full" gap={3}>
        <FieldsForm node={executorNode} field="parameters" />
        <FieldsDefinition
          node={executorNode}
          field="inputs"
          title={"Inputs"}
          onChange={handleOnInputsChange}
        />
        <FieldsDefinition
          node={executorNode}
          field="outputs"
          title="Outputs"
          onChange={handleOnOutputsChange}
        />
      </VStack>
    </ExecutionStepAccordion>
  );
}
