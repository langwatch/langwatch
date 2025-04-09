import { Textarea, VStack } from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { LLMConfigField } from "~/optimization_studio/components/properties/modals/llm-config/LLMConfigField";
import { useCallback, useMemo } from "react";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import { PropertyField } from "~/optimization_studio/components/properties/BasePropertiesPanel";
import { ExecutionStepAccordion } from "../../../components/ExecutionStepAccordion";

export const CODE_EXECUTION_STEP_ACCORDION_VALUE = "offline_code_execution";

/**
 * This component is used to configure the code execution properties for the offline execution step.
 *
 * It allows users to set up the code execution environment and parameters.
 */
export function CodeExecutionStepAccordion() {
  const {
    updateSignatureNodeLLMConfigValue,
    setNodeParameter,
    getOrCreateSignatureNode,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        updateSignatureNodeLLMConfigValue,
        setNodeParameter,
        getOrCreateSignatureNode,
      }) => ({
        updateSignatureNodeLLMConfigValue,
        getOrCreateSignatureNode,
        setNodeParameter,
      })
    )
  );

  /**
   * Find or create the signature node
   * This will run on every render to keep the signature node up to date
   * since we don't currently have a way to trigger on workflow changes
   */
  const signatureNode = getOrCreateSignatureNode();

  const updateLLMConfig = useCallback(
    (llmConfig: LLMConfig) => {
      if (!signatureNode) {
        return;
      }

      updateSignatureNodeLLMConfigValue(signatureNode.id, llmConfig);
    },
    [updateSignatureNodeLLMConfigValue, signatureNode]
  );

  const { llmConfig, codeSnippet } = useMemo(() => {
    const parameters = signatureNode?.data.parameters;
    const llmConfig = parameters?.find((p) => p.identifier === "llm");
    const codeSnippet = parameters?.find(
      (p) => p.identifier === "code_snippet"
    );

    return {
      llmConfig: llmConfig?.value as LLMConfig,
      codeSnippet: codeSnippet?.value as string | undefined,
    };
  }, [signatureNode]);

  return (
    <ExecutionStepAccordion
      value={CODE_EXECUTION_STEP_ACCORDION_VALUE}
      title="Code Execution Properties"
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
            <PropertyField title="Code Snippet">
              <Textarea
                height="200px"
                fontFamily="monospace"
                fontSize="13px"
                value={codeSnippet}
                onChange={(e) =>
                  setNodeParameter(signatureNode.id, {
                    identifier: "code_snippet",
                    type: "str",
                    value: e.target.value,
                  })
                }
                placeholder="Enter your code snippet here..."
              />
            </PropertyField>
          </>
        )}
      </VStack>
    </ExecutionStepAccordion>
  );
}
