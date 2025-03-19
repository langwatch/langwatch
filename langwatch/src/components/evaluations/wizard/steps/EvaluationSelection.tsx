import { Accordion, Heading, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import { CategorySelectionAccordion } from "./evaluations/CategorySelectionAccordion";
import { EvaluatorMappingAccordion } from "./evaluations/EvaluatorMappingAccordion";
import { EvaluatorSelectionAccordion } from "./evaluations/EvaluatorSelectionAccordion";
import { EvaluatorSettingsAccordion } from "./evaluations/EvaluatorSettingsAccordion";

export function EvaluationSelection() {
  const { wizardState, getFirstEvaluatorNode: getFirstEvaluator } = useEvaluationWizardStore();
  const [accordeonValue, setAccordeonValue] = useState<string[]>(
    wizardState.evaluatorCategory
      ? getFirstEvaluator()
        ? ["selection"]
        : ["settings"]
      : ["category"]
  );

  return (
    <VStack width="full" align="start" gap={4}>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Evaluation Type
        </Heading>
        <Text>Choose what aspect of your LLM you want to evaluate</Text>
      </VStack>

      <Accordion.Root
        value={accordeonValue}
        onValueChange={(e: { value: string[] }) => setAccordeonValue(e.value)}
        multiple={false}
        collapsible
        width="full"
        variant="plain"
      >
        <VStack width="full">
          <CategorySelectionAccordion setAccordeonValue={setAccordeonValue} />
          <EvaluatorSelectionAccordion setAccordeonValue={setAccordeonValue} />
          <EvaluatorMappingAccordion />
          <EvaluatorSettingsAccordion />
        </VStack>
      </Accordion.Root>
    </VStack>
  );
}
