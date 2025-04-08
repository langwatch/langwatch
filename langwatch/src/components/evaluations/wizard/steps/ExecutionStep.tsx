import { Heading, Text, VStack } from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../hooks/useEvaluationWizardStore";
import { RealTimeExecutionStep } from "./execution/RealTimeExecutionStep";

export function ExecutionStep() {
  const { task } = useEvaluationWizardStore(
    useShallow(({ wizardState }) => ({
      task: wizardState.task,
    }))
  );

  return (
    <VStack width="full" align="start" gap={4}>
      <VStack width="full" align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Execution
        </Heading>
        <Text>
          {task === "real_time"
            ? "When will your evaluation be executed"
            : task === "custom_evaluator"
            ? "How will the custom evaluator be executed"
            : "How to do the LLM execution"}
        </Text>
        {task === "real_time" && <RealTimeExecutionStep />}
      </VStack>
    </VStack>
  );
}
