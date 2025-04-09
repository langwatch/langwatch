import { Accordion, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import {
  EXECUTION_METHOD_SELECTOR_STEP_ACCORDION_VALUE,
  ExecutionMethodSelectionStepAccordion,
} from "./ExecutionMethodSelectionStepAccordion";
import {
  LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE,
  LlmPromptPropertiesStepAccordion,
} from "./LlmPromptPropertiesStepAccordion";
import type { WizardState } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useEvaluationWizardStore } from "../../../hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useShallow } from "zustand/react/shallow";
import {
  CODE_EXECUTION_STEP_ACCORDION_VALUE,
  CodeExecutionStepAccordion,
} from "./CodeExecutionStepAccordion";

const ExecutionMethodStepAccordionFactory = (
  executionMethod?: WizardState["executionMethod"]
) => {
  switch (executionMethod) {
    case "offline_prompt":
      return <LlmPromptPropertiesStepAccordion />;
    case "offline_code_execution":
      return <CodeExecutionStepAccordion />;
    default:
      return null;
  }
};

export function OfflineExecutionStep() {
  const [accordionValue, setAccordionValue] = useState<string[]>([
    EXECUTION_METHOD_SELECTOR_STEP_ACCORDION_VALUE,
  ]);

  const { executionMethod } = useEvaluationWizardStore(
    useShallow(({ wizardState }) => ({
      executionMethod: wizardState.executionMethod,
    }))
  );

  const updateAccordionValue = useCallback(() => {
    /**
     * Force the accordion to re-render.
     * Necessary because we want to trigger the UI to expand the correct step even if
     * the execution method is not changed.
     */
    setAccordionValue([]);
    /**
     * When the execution method is changed, we want to open the correct accordion item.
     */
    switch (executionMethod) {
      case "offline_prompt":
        setAccordionValue([LLM_PROMPT_PROPERTIES_STEP_ACCORDION_VALUE]);
        break;
      case "offline_code_execution":
        setAccordionValue([CODE_EXECUTION_STEP_ACCORDION_VALUE]);
        break;
      default:
        setAccordionValue([EXECUTION_METHOD_SELECTOR_STEP_ACCORDION_VALUE]);
    }
  }, [setAccordionValue, executionMethod]);

  return (
    <Accordion.Root
      value={accordionValue}
      onValueChange={(e) => setAccordionValue(e.value)}
      multiple={false}
      collapsible
      width="full"
      variant="plain"
    >
      <VStack width="full" gap={3}>
        <ExecutionMethodSelectionStepAccordion
          onSelect={() => {
            updateAccordionValue();
          }}
        />
        {ExecutionMethodStepAccordionFactory(executionMethod)}
      </VStack>
    </Accordion.Root>
  );
}
