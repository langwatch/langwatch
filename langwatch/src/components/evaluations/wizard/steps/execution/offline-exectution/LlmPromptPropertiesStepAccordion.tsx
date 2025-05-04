import { Textarea } from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { OptimizationStudioLLMConfigField } from "~/optimization_studio/components/properties/llm-configs/OptimizationStudioLLMConfigField";
import { useCallback, useMemo } from "react";
import type { Field, LLMConfig } from "~/optimization_studio/types/dsl";
import { PropertyField } from "~/optimization_studio/components/properties/BasePropertiesPanel";
import { ExecutionStepAccordion } from "../../../components/ExecutionStepAccordion";

export const LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE = "offline_prompt";

/**
 * This component is used to configure the LLM prompt properties for the offline execution step.
 *
 * It is a simplified version of what's available in the SignaturePropertiesPanel.
 */
export function LlmPromptPropertiesStepAccordion() {
  const {
    updateSignatureNodeLLMConfigValue,
    setNodeParameter,
    getNodesByType,
    setNodeInputs,
    setNodeOutputs,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        updateSignatureNodeLLMConfigValue,
        setNodeParameter,
        getNodesByType,
        setNodeInputs,
        setNodeOutputs,
      }) => ({
        updateSignatureNodeLLMConfigValue,
        getNodesByType,
        setNodeParameter,
        setNodeInputs,
        setNodeOutputs,
      })
    )
  );

  const signatureNode = getNodesByType("signature")[0];

  const { llmConfig, instructions } = useMemo(() => {
    const parameters = signatureNode?.data.parameters;
    const llmConfig = parameters?.find((p) => p.identifier === "llm");
    const instructions = parameters?.find(
      (p) => p.identifier === "instructions"
    );

    return {
      llmConfig: llmConfig?.value as LLMConfig,
      instructions: instructions?.value as string | undefined,
    };
  }, [signatureNode]);

  const handleOnLLMConfigChange = useCallback(
    (llmConfig: LLMConfig) => {
      if (!signatureNode) return;

      updateSignatureNodeLLMConfigValue(signatureNode.id, llmConfig);
    },
    [updateSignatureNodeLLMConfigValue, signatureNode]
  );

  const handleOnInputsChange = useCallback(
    (data: { fields: Field[] }) => {
      if (!signatureNode) return;
      setNodeInputs(signatureNode.id, data.fields);
    },
    [signatureNode, setNodeInputs]
  );

  const handleOnOutputsChange = useCallback(
    (data: { fields: Field[] }) => {
      if (!signatureNode) return;
      setNodeOutputs(signatureNode.id, data.fields);
    },
    [signatureNode, setNodeOutputs]
  );

  if (!signatureNode) {
    return null;
  }

  return (
    <ExecutionStepAccordion
      value={LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE}
      title="LLM Prompt"
      showTrigger={true}
    >
      {signatureNode && (
        <>
          <PropertyField title="LLM">
            {llmConfig && (
              <OptimizationStudioLLMConfigField
                llmConfig={llmConfig}
                onChange={handleOnLLMConfigChange}
              />
            )}
          </PropertyField>
          <PropertyField title="System Prompt">
            <Textarea
              height="100px"
              fontFamily="monospace"
              fontSize="13px"
              value={instructions}
              onChange={(e) =>
                setNodeParameter(signatureNode.id, {
                  identifier: "instructions",
                  type: "str",
                  value: e.target.value,
                })
              }
            />
          </PropertyField>
          <ExecutionStepAccordion.InputField
            node={signatureNode}
            onChange={handleOnInputsChange}
          />
          <ExecutionStepAccordion.OutputField
            node={signatureNode}
            onChange={handleOnOutputsChange}
          />
        </>
      )}
    </ExecutionStepAccordion>
  );
}
