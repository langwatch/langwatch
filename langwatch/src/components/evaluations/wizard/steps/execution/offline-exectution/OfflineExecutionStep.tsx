import { Accordion, VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import {
  EXECUTION_METHOD_SELECTOR_STEP_ACCORDION_VALUE,
  ExecutionMethodSelectionStepAccordion,
} from "./ExecutionMethodSelectionStepAccordion";
import { LlmPromptPropertiesStepAccordion } from "./LlmPromptPropertiesStepAccordion";
import type { WizardState } from "../../../hooks/useEvaluationWizardStore";
import { useEvaluationWizardStore } from "../../../hooks/useEvaluationWizardStore";
import { useShallow } from "zustand/react/shallow";

const ExecutionMethodStepAccordionFactory = (
  executionMethod?: WizardState["executionMethod"]
) => {
  switch (executionMethod) {
    case "offline_prompt":
      return <LlmPromptPropertiesStepAccordion />;
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

  /**
   * Force the accordion to render the desired accordion item.
   * Necessary because we want to open the correct step even if
   * the execution method is not changed.
   */
  const updateAccordionValue = useCallback(() => {
    setAccordionValue([]);
    if (executionMethod) {
      setAccordionValue([executionMethod]);
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
