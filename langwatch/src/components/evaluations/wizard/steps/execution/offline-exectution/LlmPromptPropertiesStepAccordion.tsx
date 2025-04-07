import { Textarea, VStack } from "@chakra-ui/react";
import { StepAccordion } from "../../../components/StepAccordion";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../../hooks/useEvaluationWizardStore";
import { LLMConfigField } from "~/optimization_studio/components/properties/modals/llm-config/LLMConfigField";
import { useCallback, useMemo } from "react";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { PropertyField } from "~/optimization_studio/components/properties/BasePropertiesPanel";

export const LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE =
  "llm-prompt-properties";

export function LlmPromptPropertiesStepAccordion() {
  const {
    executionMethod,
    addSignatureNode,
    getSignatureNodes,
    updateSignatureNodeLLMConfigValue,
    setNodeParameter,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        wizardState,
        workflowStore,
        addSignatureNode,
        getSignatureNodes,
        updateSignatureNodeLLMConfigValue,
        setNodeParameter,
      }) => ({
        executionMethod: wizardState.executionMethod,
        workflowStore,
        addSignatureNode,
        getSignatureNodes,
        updateSignatureNodeLLMConfigValue,
        setNodeParameter,
      })
    )
  );

  /**
   * Find or create the signature node
   * This will run on every render to keep the signature node up to date
   * since we don't currently have a way to trigger on workflow changes
   */
  const signatureNode = (() => {
    const signatureNodes = getSignatureNodes();

    if (signatureNodes.length > 0) {
      return signatureNodes[0];
    }

    addSignatureNode();

    return getSignatureNodes()[0];
  })();

  const updateLLMConfig = useCallback(
    (llmConfig: LLMConfig) => {
      if (!signatureNode) {
        return;
      }

      updateSignatureNodeLLMConfigValue(signatureNode.id, llmConfig);
    },
    [updateSignatureNodeLLMConfigValue, signatureNode]
  );

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

  return (
    <StepAccordion
      value={LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE}
      width="full"
      borderColor="blue.400"
      title="LLM Prompt Properties"
      showTrigger={true}
    >
      <VStack width="full" gap={3}>
        {signatureNode && (
          <>
            <PropertyField title="LLM">
              {llmConfig && (
                <LLMConfigField
                  llmConfig={llmConfig}
                  onChange={updateLLMConfig}
                />
              )}
            </PropertyField>
            <PropertyField title="Instructions">
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
          </>
        )}
      </VStack>
    </StepAccordion>
  );
}
