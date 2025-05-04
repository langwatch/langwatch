import { useShallow } from "zustand/react/shallow";
import { SignaturePropertiesPanel } from "../../../../../../optimization_studio/components/properties/llm-configs/SignaturePropertiesPanel";
import { ExecutionStepAccordion } from "../../../components/ExecutionStepAccordion";
import { useEvaluationWizardStore } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";

export const LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE = "offline_prompt";

/**
 * This component is used to configure the LLM prompt properties for the offline execution step.
 *
 * It is a simplified version of what's available in the SignaturePropertiesPanel.
 */
export function LlmPromptPropertiesStepAccordion() {
  const { getNodesByType } = useEvaluationWizardStore(
    useShallow(({ getNodesByType }) => ({
      getNodesByType,
    }))
  );

  const signatureNode = getNodesByType("signature")[0];

  if (!signatureNode) {
    return null;
  }

  return (
    <ExecutionStepAccordion
      value={LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE}
      title="LLM Prompt"
      showTrigger={true}
    >
      {signatureNode && <SignaturePropertiesPanel node={signatureNode} />}
    </ExecutionStepAccordion>
  );
}
