import { VStack } from "@chakra-ui/react";
import { StepAccordion } from "../../../components/StepAccordion";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../../hooks/useEvaluationWizardStore";

export const LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE =
  "llm-prompt-properties";

export function LlmPromptPropertiesStepAccordion() {
  const { executionMethod, addSignatureNode, getSignatureNodes } =
    useEvaluationWizardStore(
      useShallow(
        ({
          wizardState,
          workflowStore,
          addSignatureNode,
          getSignatureNodes,
        }) => ({
          executionMethod: wizardState.executionMethod,
          workflowStore,
          addSignatureNode,
          getSignatureNodes,
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

  return (
    <StepAccordion
      value={LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE}
      width="full"
      borderColor="blue.400"
      title="LLM Prompt Properties"
      showTrigger={!!executionMethod}
    >
      <VStack width="full" gap={3}>
        {signatureNode && <div>Signature Node</div>}
      </VStack>
    </StepAccordion>
  );
}
