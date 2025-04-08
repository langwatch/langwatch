import { Heading, Text, VStack } from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import {
  type TaskType,
  useEvaluationWizardStore,
} from "../hooks/useEvaluationWizardStore";
import { RealTimeExecutionStep } from "./execution/RealTimeExecutionStep";
import { OfflineExecutionStep } from "./execution/offline-exectution/OfflineExecutionStep";

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
        <Text>{chooseTaskDescription({ task })}</Text>
        <ExecutionStepFactory task={task} />
      </VStack>
    </VStack>
  );
}

// Helper functions

function chooseTaskDescription({ task }: { task: TaskType | undefined }) {
  if (!task) return null;

  switch (task) {
    case "real_time":
      return "When will your evaluation be executed";
    case "llm_app":
      return "How will the custom evaluator be executed";
    case "custom_evaluator":
      return "How to do the LLM execution";
    default:
      return null;
  }
}

// Factory function to render the appropriate step component with props
function ExecutionStepFactory({ task }: { task: TaskType | undefined }) {
  if (!task) return null;

  switch (task) {
    case "real_time":
      return <RealTimeExecutionStep />;
    case "llm_app":
      return <OfflineExecutionStep />;
    // Add other cases as needed
    default:
      return null;
  }
}
